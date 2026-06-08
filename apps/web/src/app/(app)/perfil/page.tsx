'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getApiBase } from '@/lib/api-base';
import { useIsMobile } from '@/lib/use-is-mobile';
import type { AppUser } from '@crmwhats/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function fmtPhone(raw: string): string {
  const n = raw.replace(/\D/g, '');
  const m = n.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  if (m) return `+55 (${m[1]}) ${m[2]}-${m[3]}`;
  return raw;
}

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PerfilPage() {
  const supabase = useMemo(() => createClient(), []);
  const isMobile = useIsMobile();

  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Avatar block
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoOk, setPhotoOk] = useState<string | null>(null);

  // Name block
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameOk, setNameOk] = useState<string | null>(null);

  // ── Load current user ──────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token ?? null;
      setToken(tok);
      if (!tok) throw new Error('Não autenticado.');

      const res = await fetch(`${getApiBase()}/api/users/me`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const u = await res.json() as AppUser;
      setName(u.name);
      setRole(u.role);
      setWhatsappNumber(u.whatsapp_number);
      setEmail(u.email);
      setAvatarUrl(u.avatar_url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar perfil.');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  // ── Avatar upload ───────────────────────────────────────────────────────────
  async function handlePhotoUpload(file: File) {
    setPhotoError(null);
    setPhotoOk(null);
    if (file.size > MAX_BYTES) {
      setPhotoError('Imagem excede 5 MB');
      return;
    }
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      const tok = session?.access_token ?? token;
      if (!uid || !tok) throw new Error('Não autenticado.');

      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${uid}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('wa-media')
        .upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from('wa-media').getPublicUrl(path);
      const url = pub.publicUrl;

      const res = await fetch(`${getApiBase()}/api/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ avatar_url: url }),
      });
      if (!res.ok) throw new Error(await res.text());

      setAvatarUrl(url);
      setPhotoOk('✓ Foto atualizada');
    } catch (e: unknown) {
      setPhotoError(e instanceof Error ? e.message : 'Erro ao enviar foto.');
    } finally {
      setUploading(false);
    }
  }

  // ── Remove avatar ─────────────────────────────────────────────────────────────
  async function handleRemovePhoto() {
    setPhotoError(null);
    setPhotoOk(null);
    setUploading(true);
    try {
      const tok = token;
      if (!tok) throw new Error('Não autenticado.');
      const res = await fetch(`${getApiBase()}/api/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ avatar_url: '' }),
      });
      if (!res.ok) throw new Error(await res.text());
      setAvatarUrl(null);
      setPhotoOk('✓ Foto removida');
    } catch (e: unknown) {
      setPhotoError(e instanceof Error ? e.message : 'Erro ao remover foto.');
    } finally {
      setUploading(false);
    }
  }

  // ── Save name ─────────────────────────────────────────────────────────────────
  async function handleSaveName() {
    setNameError(null);
    setNameOk(null);
    if (!name.trim()) {
      setNameError('Informe um nome.');
      return;
    }
    setSavingName(true);
    try {
      const tok = token;
      if (!tok) throw new Error('Não autenticado.');
      const res = await fetch(`${getApiBase()}/api/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const u = await res.json() as AppUser;
      setName(u.name);
      setNameOk('✓ Nome salvo');
    } catch (e: unknown) {
      setNameError(e instanceof Error ? e.message : 'Erro ao salvar nome.');
    } finally {
      setSavingName(false);
    }
  }

  // ── Render helpers ──────────────────────────────────────────────────────────
  const readonlyRow = (label: string, value: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ammoc-ink-400)' }}>{label}</span>
      <span style={{ fontSize: 14, color: 'var(--ammoc-ink-600)' }}>{value || '—'}</span>
    </div>
  );

  return (
    <div style={{ padding: isMobile ? 16 : 32, flex: 1 }}>
      {/* Header */}
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800,
        color: 'var(--ammoc-ink-900)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
        Meu Perfil
      </h1>
      <p style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, margin: '0 0 20px' }}>
        Suas informações e foto de perfil.
      </p>

      {error && (
        <div style={{ background: '#FCEBE8', color: '#C0392B', padding: '10px 14px',
          borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 14, padding: '32px 0', textAlign: 'center' }}>
          Carregando perfil…
        </div>
      ) : (
        <div style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Avatar block */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ width: 96, height: 96, borderRadius: '50%', flexShrink: 0, overflow: 'hidden' }}>
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt={name}
                  style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: '50%' }} />
              ) : (
                <div style={{ width: 96, height: 96, borderRadius: '50%', background: 'var(--ammoc-green)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white',
                  fontSize: 32, fontWeight: 700 }}>
                  {initials(name)}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <label style={{ background: 'var(--ammoc-green)', color: 'white', border: 'none',
                  borderRadius: 'var(--radius-sm)', padding: '8px 14px', fontSize: 13, fontWeight: 700,
                  cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
                  {uploading ? '⏳' : '📷 Enviar foto'}
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    disabled={uploading}
                    onChange={e => { const f = e.target.files?.[0]; if (f) void handlePhotoUpload(f); e.target.value = ''; }} />
                </label>
                {avatarUrl && (
                  <button type="button" onClick={() => void handleRemovePhoto()} disabled={uploading}
                    style={{ background: 'var(--ammoc-paper-2)', border: '1px solid var(--ammoc-line)',
                      color: 'var(--ammoc-ink-700)', borderRadius: 'var(--radius-sm)', padding: '8px 14px',
                      fontSize: 13, fontWeight: 700, cursor: uploading ? 'default' : 'pointer',
                      opacity: uploading ? 0.6 : 1 }}>
                    Remover foto
                  </button>
                )}
              </div>
              {photoError && <span style={{ fontSize: 12, color: '#C0392B' }}>{photoError}</span>}
              {photoOk && <span style={{ fontSize: 12, color: 'var(--ammoc-green-700)' }}>{photoOk}</span>}
            </div>
          </div>

          {/* Name (editable) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ammoc-ink-600)' }}>Nome</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                style={{ flex: 1, minWidth: 180, border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)',
                  padding: '9px 12px', fontSize: 14, outline: 'none', fontFamily: 'var(--font-body)',
                  background: 'var(--ammoc-paper)', color: 'var(--ammoc-ink-900)', boxSizing: 'border-box' }}
              />
              <button type="button" onClick={() => void handleSaveName()} disabled={savingName || !name.trim()}
                style={{ background: 'var(--ammoc-green)', color: 'white', border: 'none',
                  borderRadius: 'var(--radius-sm)', padding: '9px 16px', fontSize: 13, fontWeight: 700,
                  cursor: savingName || !name.trim() ? 'default' : 'pointer', flexShrink: 0,
                  opacity: savingName || !name.trim() ? 0.6 : 1 }}>
                {savingName ? '…' : 'Salvar'}
              </button>
            </div>
            {nameError && <span style={{ fontSize: 12, color: '#C0392B' }}>{nameError}</span>}
            {nameOk && <span style={{ fontSize: 12, color: 'var(--ammoc-green-700)' }}>{nameOk}</span>}
          </div>

          {/* Read-only rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16,
            borderTop: '1px solid var(--ammoc-line)', paddingTop: 20 }}>
            {readonlyRow('E-mail', email)}
            {readonlyRow('Cargo', role)}
            {readonlyRow('WhatsApp', whatsappNumber ? fmtPhone(whatsappNumber) : '—')}
          </div>
        </div>
      )}
    </div>
  );
}
