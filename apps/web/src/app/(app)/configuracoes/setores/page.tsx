'use client';
import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getApiBase } from '@/lib/api-base';

const API = getApiBase();

interface Sector {
  id: string; name: string; description: string | null;
  keywords: string[]; color: string; created_at: string;
  members: { id: string; name: string; email: string }[];
}
interface User { id: string; name: string; email: string; }

async function apiFetch(path: string, token: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function SetoresPage() {
  const supabase = createClient();
  const [token, setToken] = useState('');
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Sector | null>(null);
  const [form, setForm] = useState({ name: '', description: '', keywords: '', color: '#128C7E' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    const [secs, users] = await Promise.all([
      apiFetch('/api/sectors', tok) as Promise<Sector[]>,
      apiFetch('/api/users', tok) as Promise<User[]>,
    ]);
    setSectors(secs);
    setAllUsers(users);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token ?? '';
      setToken(tok);
      await load(tok);
    })();
  }, [load, supabase]);

  function openCreate() {
    setEditing(null);
    setForm({ name: '', description: '', keywords: '', color: '#128C7E' });
    setShowModal(true);
  }
  function openEdit(s: Sector) {
    setEditing(s);
    setForm({ name: s.name, description: s.description ?? '', keywords: s.keywords.join(', '), color: s.color });
    setShowModal(true);
  }
  async function handleSave() {
    setSaving(true); setError('');
    try {
      const body = { name: form.name, description: form.description || null, keywords: form.keywords.split(',').map(k => k.trim()).filter(Boolean), color: form.color };
      if (editing) await apiFetch(`/api/sectors/${editing.id}`, token, { method: 'PATCH', body: JSON.stringify(body) });
      else await apiFetch('/api/sectors', token, { method: 'POST', body: JSON.stringify(body) });
      setShowModal(false);
      await load(token);
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro'); }
    setSaving(false);
  }
  async function handleDelete(id: string) {
    if (!confirm('Remover este setor? As conversas delegadas a ele perderão o setor.')) return;
    await apiFetch(`/api/sectors/${id}`, token, { method: 'DELETE' });
    await load(token);
  }
  async function handleAddMember(sectorId: string, userId: string) {
    await apiFetch(`/api/sectors/${sectorId}/members`, token, { method: 'POST', body: JSON.stringify({ userId }) });
    await load(token);
  }
  async function handleRemoveMember(sectorId: string, userId: string) {
    await apiFetch(`/api/sectors/${sectorId}/members/${userId}`, token, { method: 'DELETE' });
    await load(token);
  }

  return (
    <div style={{ padding: 32, flex: 1, maxWidth: 800 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24, gap: 12 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--ammoc-ink-900)', margin: 0, letterSpacing: '-0.02em' }}>
          Setores
        </h1>
        <span style={{ background: 'var(--ammoc-paper-3)', color: 'var(--ammoc-ink-600)', fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 99 }}>{sectors.length}</span>
        <div style={{ flex: 1 }} />
        <button onClick={openCreate} style={{ background: 'var(--ammoc-green)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + Novo Setor
        </button>
      </div>

      {loading ? <p style={{ color: 'var(--ammoc-ink-400)' }}>Carregando…</p> : sectors.length === 0 ? (
        <div style={{ background: 'var(--ammoc-paper)', border: '1.5px dashed var(--ammoc-line)', borderRadius: 'var(--radius)', padding: '48px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🏛️</div>
          <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 14 }}>Nenhum setor criado ainda.</div>
        </div>
      ) : sectors.map(s => (
        <div key={s.id} style={{ background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--ammoc-ink-900)', flex: 1 }}>{s.name}</span>
            <button onClick={() => openEdit(s)} style={{ background: 'var(--ammoc-paper-2)', border: '1px solid var(--ammoc-line)', color: 'var(--ammoc-ink-700)', borderRadius: 'var(--radius-sm)', padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}>Editar</button>
            <button onClick={() => void handleDelete(s.id)} style={{ background: 'none', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 'var(--radius-sm)', padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}>Remover</button>
          </div>
          {s.description && <p style={{ fontSize: 12, color: 'var(--ammoc-ink-400)', margin: '0 0 8px' }}>{s.description}</p>}
          {s.keywords.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {s.keywords.map(k => <span key={k} style={{ background: 'var(--ammoc-paper-3)', color: 'var(--ammoc-ink-600)', fontSize: 11, padding: '2px 8px', borderRadius: 99 }}>{k}</span>)}
            </div>
          )}
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ammoc-ink-600)', marginBottom: 6 }}>Membros ({s.members.length})</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {s.members.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--ammoc-green-100)', color: 'var(--ammoc-green-800)', fontSize: 12, fontWeight: 600, padding: '3px 10px 3px 8px', borderRadius: 99 }}>
                {m.name}
                <button onClick={() => void handleRemoveMember(s.id, m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ammoc-green-700)', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
              </div>
            ))}
            <select onChange={e => { if (e.target.value) { void handleAddMember(s.id, e.target.value); e.target.value = ''; } }}
              style={{ fontSize: 12, border: '1px dashed var(--ammoc-green)', background: 'none', color: 'var(--ammoc-green-700)', borderRadius: 99, padding: '3px 8px', cursor: 'pointer' }}>
              <option value="">+ Adicionar membro</option>
              {allUsers.filter(u => !s.members.some(m => m.id === u.id)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
      ))}

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--ammoc-paper)', borderRadius: 'var(--radius)', padding: 28, width: 440, boxShadow: '0 8px 32px rgba(0,0,0,.2)' }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 800 }}>{editing ? 'Editar Setor' : 'Novo Setor'}</h2>
            {error && <div style={{ color: '#b91c1c', fontSize: 12, marginBottom: 12 }}>{error}</div>}
            {(['name','description','keywords'] as const).map(field => (
              <div key={field} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ammoc-ink-600)', display: 'block', marginBottom: 4 }}>
                  {field === 'name' ? 'Nome *' : field === 'description' ? 'Descrição' : 'Palavras-chave (vírgula)'}
                </label>
                <input value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                  placeholder={field === 'keywords' ? 'obra, esgoto, pavimento' : ''}
                  style={{ width: '100%', border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            ))}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ammoc-ink-600)', display: 'block', marginBottom: 4 }}>Cor</label>
              <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} style={{ width: 48, height: 32, border: 'none', cursor: 'pointer', borderRadius: 6 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={{ background: 'var(--ammoc-paper-2)', border: '1px solid var(--ammoc-line)', color: 'var(--ammoc-ink-600)', borderRadius: 'var(--radius-sm)', padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={() => void handleSave()} disabled={saving || !form.name} style={{ background: 'var(--ammoc-green)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
