'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useIsMobile } from '@/lib/use-is-mobile';
import { getApiBase } from '@/lib/api-base';
import type { AppUser, UserRole } from '@crmwhats/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  supervisor: 'Supervisor',
  funcionario: 'Funcionário',
};

const ROLE_STYLE: Record<UserRole, { bg: string; color: string }> = {
  admin:      { bg: '#FCEBE8', color: '#C0392B' },
  supervisor: { bg: '#EFF6FF', color: '#1D4ED8' },
  funcionario:{ bg: '#E6F0E5', color: '#166331' },
};

function RoleBadge({ role }: { role: UserRole }) {
  const s = ROLE_STYLE[role] ?? ROLE_STYLE.funcionario;
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700,
      padding: '2px 8px', borderRadius: 99, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--ammoc-green-800)',
      color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
      {initials(name)}
    </div>
  );
}

// ─── User Card ───────────────────────────────────────────────────────────────

function UserCard({
  user,
  canEdit,
  canDelete,
  onRoleChange,
  onDelete,
}: {
  user: AppUser;
  canEdit: boolean;
  canDelete: boolean;
  onRoleChange: (userId: string, newRole: UserRole) => Promise<void>;
  onDelete: (userId: string, name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  async function handleDeleteClick() {
    setDeleting(true); setFeedback(null);
    try { await onDelete(user.id, user.name); }
    catch (err: unknown) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Erro ao excluir.' });
      setDeleting(false);
    }
  }

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newRole = e.target.value as UserRole;
    setSaving(true);
    setFeedback(null);
    try {
      await onRoleChange(user.id, newRole);
      setFeedback({ ok: true, msg: 'Papel atualizado.' });
      setEditing(false);
    } catch (err: unknown) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Erro ao salvar.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)',
      borderRadius: 'var(--radius)', padding: '14px 18px',
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      {/* Avatar */}
      <Avatar name={user.name} />

      {/* Info */}
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ammoc-ink-900)' }}>{user.name}</div>
        <div style={{ fontSize: 12, color: 'var(--ammoc-ink-400)', marginTop: 1 }}>{user.email}</div>
        {user.whatsapp_number && (
          <div style={{ fontSize: 12, color: 'var(--ammoc-ink-400)', marginTop: 1 }}>
            📱 {user.whatsapp_number}
          </div>
        )}
      </div>

      {/* Role badge */}
      <RoleBadge role={user.role} />

      {/* Online dot */}
      <span title={user.is_online ? 'Online' : 'Offline'} style={{
        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
        background: user.is_online ? 'var(--status-online)' : 'var(--ammoc-line)',
        border: user.is_online ? '1.5px solid #16a34a' : '1.5px solid #b8b4ae',
      }} />

      {/* Admin role changer */}
      {canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {editing ? (
            <select
              disabled={saving}
              defaultValue={user.role}
              onChange={handleChange}
              style={{ fontSize: 13, border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)',
                padding: '5px 8px', background: 'var(--ammoc-paper)', color: 'var(--ammoc-ink-900)',
                cursor: 'pointer', outline: 'none' }}>
              <option value="funcionario">Funcionário</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Admin</option>
            </select>
          ) : (
            <button
              onClick={() => { setFeedback(null); setEditing(true); }}
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--ammoc-green-800)',
                background: 'var(--ammoc-green-50)', border: '1px solid var(--ammoc-green-100)',
                borderRadius: 'var(--radius-sm)', padding: '4px 10px', cursor: 'pointer' }}>
              Alterar papel
            </button>
          )}
          {editing && !saving && (
            <button
              onClick={() => { setEditing(false); setFeedback(null); }}
              style={{ fontSize: 12, color: 'var(--ammoc-ink-400)', background: 'none',
                border: 'none', cursor: 'pointer', padding: 0 }}>
              Cancelar
            </button>
          )}
        </div>
      )}

      {canDelete && (
        <button
          onClick={handleDeleteClick}
          disabled={deleting}
          style={{ fontSize: 12, fontWeight: 600, color: '#C0392B', background: '#FCEBE8',
            border: '1px solid #f5c6c0', borderRadius: 'var(--radius-sm)', padding: '4px 10px',
            cursor: deleting ? 'default' : 'pointer' }}>
          {deleting ? 'Excluindo…' : 'Excluir'}
        </button>
      )}

      {/* Feedback */}
      {feedback && (
        <span style={{ fontSize: 12, fontWeight: 600,
          color: feedback.ok ? 'var(--ammoc-green-800)' : 'var(--ammoc-red)' }}>
          {feedback.msg}
        </span>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function EquipePage() {
  const supabase = createClient();
  const isMobile = useIsMobile();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        const [allRes, meRes] = await Promise.all([
          supabase.from('users').select('*').order('name'),
          authUser
            ? supabase.from('users').select('*').eq('id', authUser.id).single()
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (allRes.error) throw allRes.error;
        setUsers((allRes.data ?? []) as AppUser[]);
        if (meRes.data) setCurrentUser(meRes.data as AppUser);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar equipe.');
      } finally {
        setLoading(false);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRoleChange = useCallback(async (userId: string, newRole: UserRole) => {
    const { error: err } = await supabase.from('users').update({ role: newRole }).eq('id', userId);
    if (err) throw err;
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = useCallback(async (userId: string, name: string) => {
    if (!confirm(`Excluir o usuário "${name}"? Esta ação é irreversível. O histórico de atendimentos é preservado.`)) return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const res = await fetch(`${getApiBase()}/api/users/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(body.message ?? 'Erro ao excluir');
    }
    setUsers(prev => prev.filter(u => u.id !== userId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canEdit = currentUser?.role === 'admin';

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  return (
    <div style={{ padding: isMobile ? 16 : '32px', flex: 1 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800,
          color: 'var(--ammoc-ink-900)', margin: 0, letterSpacing: '-0.02em' }}>
          Equipe
        </h1>
        {!loading && (
          <span style={{ fontSize: 13, color: 'var(--ammoc-ink-400)', fontFamily: 'var(--font-body)' }}>
            {users.length} {users.length === 1 ? 'membro' : 'membros'}
          </span>
        )}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Buscar por nome ou e-mail…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)',
          padding: '9px 12px', fontSize: 14, outline: 'none', fontFamily: 'var(--font-body)',
          background: 'var(--ammoc-paper)', color: 'var(--ammoc-ink-900)', marginBottom: 16, boxSizing: 'border-box' }}
      />

      {/* Error */}
      {error && (
        <div style={{ background: '#FCEBE8', color: '#C0392B', padding: '10px 14px',
          borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>
          Carregando equipe…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>
          Nenhum membro encontrado.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(u => (
            <UserCard
              key={u.id}
              user={u}
              canEdit={canEdit}
              onRoleChange={handleRoleChange}
              canDelete={canEdit && u.id !== currentUser?.id}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
