'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getApiBase } from '@/lib/api-base';
import { useIsMobile } from '@/lib/use-is-mobile';
import { phoneKey } from '@/lib/phone';

// ─── Types ───────────────────────────────────────────────────────────────────

type Origem = 'pessoal' | 'canal' | 'ambos';

interface SourceRow {
  contact_id: string | null;
  contact_name: string;
  contact_number: string;
  municipality: string | null;
  status: string;
  last_message_at: string | null;
  origem: 'pessoal' | 'canal';
}

interface Category {
  id: string;
  name: string;
  color: string;
}

interface Contact {
  contactId: string;         // canonical contacts.id (dedupe key) — unifica Canal + pessoal
  number: string;            // representative normalized digits (display + writes)
  rawNumber: string;         // first-seen raw number (for display fallback)
  name: string;
  municipality: string | null;
  status: string;
  last_message_at: string | null;
  origem: Origem;
  categoryIds: string[];
  photoUrl?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const norm = (raw: string) => raw.replace(/\D/g, '');

function fmtPhone(raw: string) {
  const n = raw.replace(/\D/g, '');
  const m = n.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  if (m) return `+55 (${m[1]}) ${m[2]}-${m[3]}`;
  return raw;
}

const AVATAR_COLORS = ['#25D366', '#128C7E', '#075E54', '#34B7F1', '#00BFA5', '#1565C0', '#6A1B9A', '#AD1457', '#E65100', '#558B2F'];
function avatarColor(name: string) {
  const idx = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}
function initials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

// Readable text color for a given hex background
function textOn(hex: string) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return '#fff';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1a1a1a' : '#fff';
}

const ORIGEM_STYLE: Record<Origem, { bg: string; color: string; label: string }> = {
  pessoal: { bg: '#E6F0E5', color: '#166331', label: 'Pessoal' },
  canal:   { bg: '#E0F2FE', color: '#075985', label: 'Canal' },
  ambos:   { bg: '#EDE9FE', color: '#6D28D9', label: 'Ambos' },
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ContatosPage() {
  const supabase = useMemo(() => createClient(), []);
  const isMobile = useIsMobile();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isManager, setIsManager] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});

  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null);   // category id | null = Todas
  const [activeOrigem, setActiveOrigem] = useState<Origem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // categories modal
  const [showCatModal, setShowCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#128C7E');
  const [catSaving, setCatSaving] = useState(false);
  const [catError, setCatError] = useState('');

  // per-contact upload state (keyed by canonical contactId)
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const categoryById = useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  // ── Load all data ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      setToken(session?.access_token ?? null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado.');

      const { data: roleRow } = await supabase.from('users').select('role').eq('id', user.id).single();
      const role = (roleRow as { role?: string } | null)?.role;
      setIsManager(role === 'admin' || role === 'supervisor');

      const [convRes, canalRes, catRes, assignRes, photoRes] = await Promise.all([
        supabase.from('conversations')
          .select('contact_id, contact_name, contact_number, municipality, status, last_message_at')
          .neq('status', 'nao_salva'),
        supabase.from('canal_conversations')
          .select('contact_id, wa_contact_name, wa_contact_number, status, last_message_at'),
        supabase.from('contact_categories').select('id, name, color').order('name'),
        supabase.from('contact_category_assignments').select('contact_id, contact_number, category_id'),
        supabase.from('contact_photos').select('contact_id, contact_number, photo_url'),
      ]);

      if (convRes.error) throw convRes.error;
      if (canalRes.error) throw canalRes.error;
      if (catRes.error) throw catRes.error;

      const cats = (catRes.data ?? []) as Category[];
      setCategories(cats);

      // contact_id → category_ids
      const catMap = new Map<string, string[]>();
      for (const a of (assignRes.data ?? []) as { contact_id: string | null; category_id: string }[]) {
        if (!a.contact_id) continue;
        const arr = catMap.get(a.contact_id) ?? [];
        if (!arr.includes(a.category_id)) arr.push(a.category_id);
        catMap.set(a.contact_id, arr);
      }
      // contact_id → photo_url
      const photoMap = new Map<string, string>();
      for (const p of (photoRes.data ?? []) as { contact_id: string | null; photo_url: string }[]) {
        if (p.contact_id) photoMap.set(p.contact_id, p.photo_url);
      }

      const rows: SourceRow[] = [
        ...((convRes.data ?? []) as Array<{ contact_id: string | null; contact_name: string; contact_number: string; municipality: string | null; status: string; last_message_at: string | null }>).map(r => ({
          contact_id: r.contact_id,
          contact_name: r.contact_name,
          contact_number: r.contact_number,
          municipality: r.municipality,
          status: r.status,
          last_message_at: r.last_message_at,
          origem: 'pessoal' as const,
        })),
        ...((canalRes.data ?? []) as Array<{ contact_id: string | null; wa_contact_name: string | null; wa_contact_number: string; status: string; last_message_at: string | null }>).map(r => ({
          contact_id: r.contact_id,
          contact_name: r.wa_contact_name ?? r.wa_contact_number,
          contact_number: r.wa_contact_number,
          municipality: null,
          status: r.status,
          last_message_at: r.last_message_at,
          origem: 'canal' as const,
        })),
      ];

      // Dedupe by canonical contact_id (fallback: normalized number quando sem contato).
      // Número X que entra pelo Canal E pelo compartilhado vira 1 contato só.
      const map = new Map<string, Contact>();
      for (const r of rows) {
        const num = norm(r.contact_number);
        if (!r.contact_id && !num) continue;
        const key = r.contact_id ?? `n:${phoneKey(r.contact_number)}`;
        const existing = map.get(key);
        if (!existing) {
          map.set(key, {
            contactId: key,
            number: num,
            rawNumber: r.contact_number,
            name: r.contact_name,
            municipality: r.municipality,
            status: r.status,
            last_message_at: r.last_message_at,
            origem: r.origem,
            categoryIds: r.contact_id ? (catMap.get(r.contact_id) ?? []) : [],
            photoUrl: r.contact_id ? photoMap.get(r.contact_id) : undefined,
          });
        } else {
          const origem: Origem = existing.origem === r.origem ? existing.origem : 'ambos';
          const existTs = existing.last_message_at ? new Date(existing.last_message_at).getTime() : 0;
          const newTs = r.last_message_at ? new Date(r.last_message_at).getTime() : 0;
          if (newTs > existTs) {
            map.set(key, {
              ...existing,
              name: r.contact_name,
              municipality: r.municipality ?? existing.municipality,
              status: r.status,
              last_message_at: r.last_message_at,
              origem,
            });
          } else {
            existing.origem = origem;
            existing.municipality = existing.municipality ?? r.municipality;
          }
        }
      }

      const list = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      setContacts(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar contatos.');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter(c => {
      if (q && !(
        c.name.toLowerCase().includes(q) ||
        c.number.includes(q) ||
        (c.municipality ?? '').toLowerCase().includes(q)
      )) return false;
      if (activeCat && !c.categoryIds.includes(activeCat)) return false;
      if (activeOrigem && c.origem !== activeOrigem) return false;
      return true;
    });
  }, [contacts, search, activeCat, activeOrigem]);

  // ── Lazy avatar fetch (first ~30 filtered without manual photo) ──────────────
  useEffect(() => {
    if (!token) return;
    const targets = filtered.filter(c => !c.photoUrl && !(c.number in avatars)).slice(0, 30);
    if (targets.length === 0) return;
    const base = getApiBase();
    let cancelled = false;
    void (async () => {
      for (const c of targets) {
        if (cancelled) return;
        try {
          const res = await fetch(`${base}/api/whatsapp/avatar?number=${c.number}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = res.ok ? (await res.json() as { url: string | null }) : { url: null };
          setAvatars(prev => ({ ...prev, [c.number]: data.url }));
        } catch {
          setAvatars(prev => ({ ...prev, [c.number]: null }));
        }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, token]);

  // ── Category assign / remove ─────────────────────────────────────────────────
  // Escrita por contact_number (trigger resolve o contact_id); leitura/estado por contactId.
  async function assignCategory(c: Contact, categoryId: string) {
    const { error: err } = await supabase
      .from('contact_category_assignments')
      .insert({ contact_number: c.number, category_id: categoryId });
    if (err) { setError(err.message); return; }
    setContacts(prev => prev.map(x =>
      x.contactId === c.contactId && !x.categoryIds.includes(categoryId)
        ? { ...x, categoryIds: [...x.categoryIds, categoryId] }
        : x));
  }
  async function removeCategory(c: Contact, categoryId: string) {
    const del = supabase.from('contact_category_assignments').delete().eq('category_id', categoryId);
    // Remove por contact_id (cobre múltiplos números do mesmo contato); fallback por número.
    const { error: err } = c.contactId.startsWith('n:')
      ? await del.eq('contact_number', c.number)
      : await del.eq('contact_id', c.contactId);
    if (err) { setError(err.message); return; }
    setContacts(prev => prev.map(x =>
      x.contactId === c.contactId
        ? { ...x, categoryIds: x.categoryIds.filter(id => id !== categoryId) }
        : x));
  }

  // ── Photo upload ─────────────────────────────────────────────────────────────
  async function handlePhotoUpload(c: Contact, file: File) {
    setUploadingId(c.contactId);
    setError(null);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `contacts/${c.number}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('wa-media')
        .upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('wa-media').getPublicUrl(path);
      const photoUrl = pub.publicUrl;
      const { error: dbErr } = await supabase
        .from('contact_photos')
        .upsert({ contact_number: c.number, photo_url: photoUrl });
      if (dbErr) throw dbErr;
      // Espelha no contato canônico (unifica a foto em todo o sistema).
      if (!c.contactId.startsWith('n:')) {
        await supabase.from('contacts').update({ photo_url: photoUrl }).eq('id', c.contactId);
      }
      setContacts(prev => prev.map(x => x.contactId === c.contactId ? { ...x, photoUrl } : x));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar foto.');
    } finally {
      setUploadingId(null);
    }
  }

  // ── Categories CRUD (modal) ──────────────────────────────────────────────────
  async function createCategory() {
    if (!newCatName.trim()) return;
    setCatSaving(true); setCatError('');
    const { error: err } = await supabase
      .from('contact_categories')
      .insert({ name: newCatName.trim(), color: newCatColor });
    if (err) { setCatError(err.message); setCatSaving(false); return; }
    setNewCatName(''); setNewCatColor('#128C7E');
    setCatSaving(false);
    await load();
  }
  async function deleteCategory(id: string) {
    if (!confirm('Remover esta categoria? Os contatos perderão essa classificação.')) return;
    const { error: err } = await supabase.from('contact_categories').delete().eq('id', id);
    if (err) { setCatError(err.message); return; }
    if (activeCat === id) setActiveCat(null);
    await load();
  }

  // ── Render helpers ────────────────────────────────────────────────────────────
  const chip = (cat: Category, active: boolean): React.CSSProperties => ({
    background: active ? cat.color : 'var(--ammoc-paper)',
    color: active ? textOn(cat.color) : 'var(--ammoc-ink-600)',
    border: `1.5px solid ${cat.color}`,
    fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 99,
    cursor: 'pointer', whiteSpace: 'nowrap',
  });

  return (
    <div style={{ padding: isMobile ? 16 : 32, flex: 1 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800,
          color: 'var(--ammoc-ink-900)', margin: 0, letterSpacing: '-0.02em' }}>
          Contatos
        </h1>
        {!loading && (
          <span style={{ fontSize: 13, color: 'var(--ammoc-ink-400)', fontFamily: 'var(--font-body)' }}>
            {contacts.length} {contacts.length === 1 ? 'contato' : 'contatos'}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {isManager && (
          <button type="button" onClick={() => { setCatError(''); setShowCatModal(true); }}
            style={{ background: 'var(--ammoc-paper-2)', border: '1px solid var(--ammoc-line)',
              color: 'var(--ammoc-ink-700)', borderRadius: 'var(--radius-sm)', padding: '7px 14px',
              fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            🏷️ Categorias
          </button>
        )}
      </div>
      <p style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, margin: '0 0 20px' }}>
        Base de contatos da organização.
      </p>

      {/* Search */}
      <input
        type="text"
        placeholder="Buscar nome, número ou município…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)',
          padding: '9px 12px', fontSize: 14, outline: 'none', fontFamily: 'var(--font-body)',
          background: 'var(--ammoc-paper)', color: 'var(--ammoc-ink-900)', marginBottom: 12, boxSizing: 'border-box' }}
      />

      {/* Category filter chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <button type="button" onClick={() => setActiveCat(null)}
          style={{ background: activeCat === null ? 'var(--ammoc-green)' : 'var(--ammoc-paper)',
            color: activeCat === null ? 'white' : 'var(--ammoc-ink-600)',
            border: '1.5px solid var(--ammoc-green)', fontSize: 12, fontWeight: 700,
            padding: '4px 12px', borderRadius: 99, cursor: 'pointer' }}>
          Todas
        </button>
        {categories.map(cat => (
          <button key={cat.id} type="button"
            onClick={() => setActiveCat(activeCat === cat.id ? null : cat.id)}
            style={chip(cat, activeCat === cat.id)}>
            {cat.name}
          </button>
        ))}
      </div>

      {/* Origem filter */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        {(['pessoal', 'canal', 'ambos'] as Origem[]).map(o => {
          const s = ORIGEM_STYLE[o];
          const active = activeOrigem === o;
          return (
            <button key={o} type="button"
              onClick={() => setActiveOrigem(active ? null : o)}
              style={{ background: active ? s.color : s.bg, color: active ? '#fff' : s.color,
                border: 'none', fontSize: 11, fontWeight: 700, padding: '3px 10px',
                borderRadius: 99, cursor: 'pointer' }}>
              {s.label}
            </button>
          );
        })}
        {activeOrigem && (
          <button type="button" onClick={() => setActiveOrigem(null)}
            style={{ background: 'none', border: 'none', color: 'var(--ammoc-ink-400)', fontSize: 12, cursor: 'pointer' }}>
            limpar origem
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: '#FCEBE8', color: '#C0392B', padding: '10px 14px',
          borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Loading / empty */}
      {loading && (
        <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 14, padding: '32px 0', textAlign: 'center' }}>
          Carregando contatos…
        </div>
      )}
      {!loading && filtered.length === 0 && (
        <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 14, padding: '32px 0', textAlign: 'center' }}>
          Nenhum contato encontrado.
        </div>
      )}

      {/* Contact cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(c => {
          const photo = c.photoUrl ?? avatars[c.number] ?? null;
          const origem = ORIGEM_STYLE[c.origem];
          return (
            <div key={c.contactId}
              style={{ background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)',
                borderRadius: 'var(--radius)', padding: '12px 16px',
                display: 'flex', alignItems: 'flex-start', gap: 12,
                boxShadow: 'var(--shadow-card)', flexWrap: 'wrap' }}>
              {/* Avatar */}
              <div style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, overflow: 'hidden' }}>
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt={c.name}
                    style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: '50%' }}
                    onError={() => setAvatars(prev => ({ ...prev, [c.number]: null }))} />
                ) : (
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: avatarColor(c.name),
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white',
                    fontSize: 15, fontWeight: 700 }}>
                    {initials(c.name)}
                  </div>
                )}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ammoc-ink-900)',
                    overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.name}
                  </span>
                  <span style={{ background: origem.bg, color: origem.color, fontSize: 10, fontWeight: 700,
                    padding: '1px 8px', borderRadius: 99 }}>
                    {origem.label}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)', fontFamily: 'var(--font-body)' }}>
                    {fmtPhone(c.rawNumber)}
                  </span>
                  {c.municipality && (
                    <span style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>📍 {c.municipality}</span>
                  )}
                </div>

                {/* Category chips */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                  {c.categoryIds.map(id => {
                    const cat = categoryById.get(id);
                    if (!cat) return null;
                    return (
                      <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                        background: cat.color, color: textOn(cat.color), fontSize: 11, fontWeight: 700,
                        padding: '2px 8px', borderRadius: 99 }}>
                        {cat.name}
                        {isManager && (
                          <button type="button" onClick={() => void removeCategory(c, id)}
                            title="Remover categoria"
                            style={{ background: 'none', border: 'none', cursor: 'pointer',
                              color: textOn(cat.color), fontSize: 13, lineHeight: 1, padding: 0 }}>
                            ✕
                          </button>
                        )}
                      </span>
                    );
                  })}
                  {isManager && categories.some(cat => !c.categoryIds.includes(cat.id)) && (
                    <select
                      value=""
                      onChange={e => { if (e.target.value) { void assignCategory(c, e.target.value); e.target.value = ''; } }}
                      style={{ fontSize: 11, border: '1px dashed var(--ammoc-green)', background: 'none',
                        color: 'var(--ammoc-green-700)', borderRadius: 99, padding: '2px 8px', cursor: 'pointer' }}>
                      <option value="">＋ categoria</option>
                      {categories.filter(cat => !c.categoryIds.includes(cat.id)).map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* Photo upload (managers) */}
              {isManager && (
                <label title="Enviar foto"
                  style={{ flexShrink: 0, cursor: uploadingId === c.contactId ? 'default' : 'pointer',
                    fontSize: 18, alignSelf: 'center', opacity: uploadingId === c.contactId ? 0.5 : 1 }}>
                  {uploadingId === c.contactId ? '⏳' : '📷'}
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    disabled={uploadingId === c.contactId}
                    onChange={e => { const f = e.target.files?.[0]; if (f) void handlePhotoUpload(c, f); e.target.value = ''; }} />
                </label>
              )}
            </div>
          );
        })}
      </div>

      {/* Categories modal */}
      {showCatModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--ammoc-paper)', borderRadius: 'var(--radius)', padding: 28,
            width: isMobile ? '92vw' : 440, maxWidth: '92vw', boxShadow: '0 8px 32px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Categorias</h2>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={() => setShowCatModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ammoc-ink-400)' }}>
                ✕
              </button>
            </div>
            {catError && <div style={{ color: '#b91c1c', fontSize: 12, marginBottom: 12 }}>{catError}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {categories.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--ammoc-ink-400)' }}>Nenhuma categoria ainda.</div>
              )}
              {categories.map(cat => (
                <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 16, height: 16, borderRadius: '50%', background: cat.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--ammoc-ink-900)' }}>{cat.name}</span>
                  <button type="button" onClick={() => void deleteCategory(cat.id)}
                    style={{ background: 'none', border: '1px solid #fca5a5', color: '#b91c1c',
                      borderRadius: 'var(--radius-sm)', padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}>
                    Remover
                  </button>
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--ammoc-line)', paddingTop: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ammoc-ink-600)', display: 'block', marginBottom: 6 }}>
                Nova categoria
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={newCatName} onChange={e => setNewCatName(e.target.value)}
                  placeholder="Nome da categoria"
                  style={{ flex: 1, border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)',
                    padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                <input type="color" value={newCatColor} onChange={e => setNewCatColor(e.target.value)}
                  style={{ width: 40, height: 34, border: 'none', cursor: 'pointer', borderRadius: 6, flexShrink: 0 }} />
                <button type="button" onClick={() => void createCategory()} disabled={catSaving || !newCatName.trim()}
                  style={{ background: 'var(--ammoc-green)', color: 'white', border: 'none',
                    borderRadius: 'var(--radius-sm)', padding: '8px 16px', fontSize: 13, fontWeight: 700,
                    cursor: catSaving || !newCatName.trim() ? 'default' : 'pointer', flexShrink: 0,
                    opacity: catSaving || !newCatName.trim() ? 0.6 : 1 }}>
                  {catSaving ? '…' : 'Criar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
