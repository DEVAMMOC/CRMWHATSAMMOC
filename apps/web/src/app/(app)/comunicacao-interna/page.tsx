'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getApiBase } from '@/lib/api-base';
import { useIsMobile } from '@/lib/use-is-mobile';
import type { InternalMessage } from '@crmwhats/types';

const API = getApiBase();

// Subset of the /api/users payload we need for the people picker.
interface OrgUser {
  id: string;
  name: string;
  role: string;
}

function initialsOf(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function ComunicacaoInternaPage() {
  const supabase = useMemo(() => createClient(), []);
  const isMobile = useIsMobile();

  const [meId, setMeId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Unread counts keyed by the OTHER user id (sender_id) — messages addressed to me.
  const [unread, setUnread] = useState<Record<string, number>>({});
  // Most-recent message timestamp per other user, for sorting the list.
  const [lastAt, setLastAt] = useState<Record<string, string>>({});

  // Load the user list once (people picker), excluding myself.
  const loadUsers = useCallback(async (tok: string, me: string) => {
    setUsersError(null);
    try {
      const res = await fetch(`${API}/api/users`, { headers: { Authorization: `Bearer ${tok}` } });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as OrgUser[];
      setUsers((data ?? []).filter(u => u.id !== me));
    } catch (e) {
      setUsersError(e instanceof Error ? e.message : 'Erro ao carregar usuários');
    }
    setLoadingUsers(false);
  }, []);

  // Compute the unread badge + last-activity maps from all my conversations.
  const loadOverview = useCallback(async (me: string) => {
    const { data, error } = await supabase
      .from('internal_messages')
      .select('sender_id,recipient_id,read_at,created_at')
      .or(`sender_id.eq.${me},recipient_id.eq.${me}`)
      .order('created_at', { ascending: false });
    if (error || !data) return;
    const nextUnread: Record<string, number> = {};
    const nextLast: Record<string, string> = {};
    for (const m of data) {
      const other = m.sender_id === me ? m.recipient_id : m.sender_id;
      if (!other) continue;
      if (!nextLast[other]) nextLast[other] = m.created_at;
      if (m.recipient_id === me && m.sender_id === other && m.read_at === null) {
        nextUnread[other] = (nextUnread[other] ?? 0) + 1;
      }
    }
    setUnread(nextUnread);
    setLastAt(nextLast);
  }, [supabase]);

  useEffect(() => {
    let iv: ReturnType<typeof setInterval> | null = null;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token ?? null;
      const me = session?.user?.id ?? null;
      setToken(tok);
      setMeId(me);
      if (tok && me) {
        await loadUsers(tok, me);
        await loadOverview(me);
        iv = setInterval(() => { void loadOverview(me); }, 5000);
      } else {
        setLoadingUsers(false);
      }
    })();
    return () => { if (iv) clearInterval(iv); };
  }, [supabase, loadUsers, loadOverview]);

  const filtered = users
    .filter(u => {
      const q = search.toLowerCase();
      if (!q) return true;
      return u.name.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const ua = unread[a.id] ?? 0;
      const ub = unread[b.id] ?? 0;
      if (ua !== ub) return ub - ua; // unread first
      const la = lastAt[a.id] ?? '';
      const lb = lastAt[b.id] ?? '';
      if (la !== lb) return lb.localeCompare(la); // most recent first
      return a.name.localeCompare(b.name);
    });

  const selected = users.find(u => u.id === selectedId) ?? null;

  // When a conversation is read inside the panel, clear its badge locally too.
  const handleMarkedRead = useCallback((otherId: string) => {
    setUnread(prev => {
      if (!prev[otherId]) return prev;
      const next = { ...prev };
      delete next[otherId];
      return next;
    });
  }, []);

  return (
    <div style={{ padding: isMobile ? 16 : 32, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--ammoc-ink-900)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
        Comunicação Interna
      </h1>
      <p style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, margin: '0 0 16px' }}>
        Converse com a equipe — fica salvo no sistema.
      </p>

      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0, height: isMobile ? 'calc(100dvh - 140px)' : 'calc(100vh - 180px)' }}>
        {/* LEFT — people list */}
        <div style={{ width: isMobile ? '100%' : 340, flexShrink: isMobile ? 1 : 0, display: isMobile && selectedId ? 'none' : 'flex', flexDirection: 'column', background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--ammoc-line-2)', background: 'var(--ammoc-paper-2)' }}>
            <input
              type="text"
              placeholder="🔍  Pesquisar pessoa..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '7px 12px', fontSize: 13, outline: 'none', color: 'var(--ammoc-ink-900)', boxSizing: 'border-box' }}
            />
          </div>

          {usersError && (
            <div style={{ padding: '10px 16px', fontSize: 13, color: '#b91c1c', background: '#fef2f2', borderBottom: '1px solid #fca5a5' }}>{usersError}</div>
          )}

          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {loadingUsers ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ammoc-ink-400)', fontSize: 13 }}>Carregando equipe…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--ammoc-ink-400)' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Nenhuma pessoa</div>
                <div style={{ fontSize: 12 }}>Os outros usuários do sistema aparecerão aqui.</div>
              </div>
            ) : (
              filtered.map(u => {
                const isHovered = hoveredId === u.id;
                const count = unread[u.id] ?? 0;
                return (
                  <div
                    key={u.id}
                    onClick={() => setSelectedId(u.id)}
                    onMouseEnter={() => setHoveredId(u.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                      borderBottom: '1px solid var(--ammoc-line-2)',
                      background: selectedId === u.id ? 'var(--ammoc-green-100)' : (isHovered ? 'var(--ammoc-paper-2)' : 'transparent'),
                      transition: 'background 0.1s', cursor: 'pointer',
                    }}
                  >
                    <div style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, background: 'var(--ammoc-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 15, fontWeight: 700 }}>
                      {initialsOf(u.name) || '?'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ammoc-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>{u.role}</div>
                    </div>
                    {count > 0 && (
                      <span style={{ flexShrink: 0, minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: 'var(--ammoc-green)', color: 'white', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {count}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT — conversation panel */}
        <div style={{ flex: 1, minWidth: 0, display: isMobile && !selectedId ? 'none' : 'flex', border: '1px solid var(--ammoc-line-2)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--ammoc-paper)' }}>
          {selected && meId ? (
            <InternalChatPanel
              key={selected.id}
              meId={meId}
              other={selected}
              onBack={() => setSelectedId(null)}
              onMarkedRead={handleMarkedRead}
            />
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ammoc-ink-400)', fontSize: 14, flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 40 }}>💬</div>
              Selecione um usuário para conversar
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface PanelProps {
  meId: string;
  other: OrgUser;
  onBack?: () => void;
  onMarkedRead?: (otherId: string) => void;
}

function InternalChatPanel({ meId, other, onBack, onMarkedRead }: PanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<InternalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const orFilter = `and(sender_id.eq.${meId},recipient_id.eq.${other.id}),and(sender_id.eq.${other.id},recipient_id.eq.${meId})`;

  // Mark incoming unread messages from this user as read.
  const markRead = useCallback(async () => {
    await supabase
      .from('internal_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', meId)
      .eq('sender_id', other.id)
      .is('read_at', null);
    onMarkedRead?.(other.id);
  }, [supabase, meId, other.id, onMarkedRead]);

  const loadMessages = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('internal_messages')
      .select('*')
      .or(orFilter)
      .order('created_at', { ascending: true });
    if (!err) setMessages((data ?? []) as InternalMessage[]);
    setLoading(false);
  }, [supabase, orFilter]);

  useEffect(() => {
    setLoading(true);
    void (async () => {
      await loadMessages();
      await markRead();
    })();
    const iv = setInterval(() => {
      void (async () => {
        await loadMessages();
        await markRead();
      })();
    }, 5000);
    return () => clearInterval(iv);
  }, [loadMessages, markRead]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function handleSend() {
    if (!text.trim() || sending) return;
    setSending(true); setError(null);
    const body = text.trim();
    setText('');
    try {
      const { error: err } = await supabase
        .from('internal_messages')
        .insert({ sender_id: meId, recipient_id: other.id, body });
      if (err) throw new Error(err.message);
      await loadMessages();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar');
      setText(body);
    }
    setSending(false);
  }

  const initials = initialsOf(other.name);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--ammoc-line-2)', background: 'var(--ammoc-paper-2)' }}>
        {onBack && (
          <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ammoc-ink-600)', padding: 0, marginRight: 2 }}>←</button>
        )}
        <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, background: 'var(--ammoc-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 14 }}>
          {initials || '?'}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ammoc-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{other.name}</div>
          <div style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>{other.role}</div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--ammoc-surface, #f7f5f0)' }}>
        {loading ? (
          <div style={{ margin: 'auto', color: 'var(--ammoc-ink-400)', fontSize: 13 }}>Carregando…</div>
        ) : messages.length === 0 ? (
          <div style={{ margin: 'auto', color: 'var(--ammoc-ink-400)', fontSize: 13, fontStyle: 'italic' }}>Sem mensagens ainda</div>
        ) : messages.map(m => {
          const mine = m.sender_id === meId;
          return (
            <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '72%', background: mine ? 'var(--ammoc-green-100)' : 'white', border: '1px solid var(--ammoc-line-2)', borderRadius: 10, padding: '6px 10px' }}>
              <div style={{ fontSize: 13, color: 'var(--ammoc-ink-900)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
              <div style={{ fontSize: 10, color: 'var(--ammoc-ink-400)', textAlign: 'right', marginTop: 2 }}>{fmtTime(m.created_at)}</div>
            </div>
          );
        })}
      </div>

      {error && (
        <div style={{ padding: '8px 16px', fontSize: 12, color: '#b91c1c', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: '#b91c1c', flexShrink: 0 }}>×</button>
        </div>
      )}

      {/* Composer */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '10px 12px', borderTop: '1px solid var(--ammoc-line-2)', background: 'var(--ammoc-paper-2)' }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
          placeholder="Digite uma mensagem…"
          rows={1}
          style={{ flex: 1, resize: 'none', border: '1px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none', maxHeight: 120, color: 'var(--ammoc-ink-900)', background: 'var(--ammoc-paper)' }}
        />
        <button type="button" onClick={() => void handleSend()} disabled={sending || !text.trim()}
          style={{ background: 'var(--ammoc-green)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: sending || !text.trim() ? 'default' : 'pointer', opacity: !text.trim() ? 0.5 : 1, flexShrink: 0 }}>
          {sending ? '…' : 'Enviar'}
        </button>
      </div>
    </div>
  );
}
