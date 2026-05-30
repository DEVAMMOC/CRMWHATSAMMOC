'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

interface Conversation {
  id: string;
  contact_number: string;
  contact_name: string | null;
  status: string;
  municipality: string | null;
}

interface Message {
  id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  content: string;
  message_type: string;
  sent_at: string;
}

function fmtTime(ts: string) {
  const d = new Date(ts);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(ts: string) {
  const d = new Date(ts);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (d.toDateString() === now.toDateString()) return 'Hoje';
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function ConversaPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Contact info panel
  const [showInfo, setShowInfo] = useState(false);
  const [editName, setEditName] = useState('');
  const [editMunicipality, setEditMunicipality] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);

  // Share
  const [sharing, setSharing] = useState(false);

  // Delegation
  const [sectors, setSectors] = useState<{ id: string; name: string; color: string }[]>([]);
  const [sectorUsers, setSectorUsers] = useState<{ id: string; name: string }[]>([]);
  const [showDelegate, setShowDelegate] = useState(false);
  const [delegateSectorId, setDelegateSectorId] = useState('');
  const [delegateUserId, setDelegateUserId] = useState('');
  const [delegating, setDelegating] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load conversation + messages
  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);

      const [{ data: convData }, { data: msgData }] = await Promise.all([
        supabase
          .from('conversations')
          .select('id, contact_number, contact_name, status, municipality')
          .eq('id', id)
          .single(),
        supabase
          .from('messages')
          .select('id, conversation_id, direction, content, message_type, sent_at')
          .eq('conversation_id', id)
          .order('sent_at', { ascending: true }),
      ]);

      if (convData) {
        const c = convData as Conversation;
        setConv(c);
        setEditName(c.contact_name ?? '');
        setEditMunicipality(c.municipality ?? '');
      }
      if (msgData) setMessages(msgData as Message[]);

      const { data: sectorData } = await supabase.from('sectors').select('id, name, color').order('name');
      setSectors((sectorData ?? []) as { id: string; name: string; color: string }[]);

      setLoading(false);
    })();
  }, [id]);

  // Load sector members when a sector is selected
  useEffect(() => {
    if (!delegateSectorId) { setSectorUsers([]); setDelegateUserId(''); return; }
    void supabase
      .from('sector_members')
      .select('user_id, users(id, name)')
      .eq('sector_id', delegateSectorId)
      .then(({ data }) => {
        const rows = (data ?? []) as { users: { id: string; name: string } | { id: string; name: string }[] | null }[];
        setSectorUsers(
          rows
            .map(m => (Array.isArray(m.users) ? m.users[0] : m.users))
            .filter((u): u is { id: string; name: string } => !!u),
        );
      });
  }, [delegateSectorId, supabase]);

  // Scroll to bottom when messages load or change
  useEffect(() => {
    if (!loading) scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  // Realtime subscription for new messages
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`messages:${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` },
        (payload) => {
          setMessages(prev => {
            const m = payload.new as Message;
            // Replace any matching optimistic message (same content + direction)
            // so outgoing messages don't appear twice.
            const optIdx = prev.findIndex(
              x => x.id.startsWith('opt-') && x.content === m.content && x.direction === m.direction,
            );
            if (optIdx >= 0) {
              const next = [...prev];
              next[optIdx] = m;
              return next;
            }
            // Avoid duplicates on re-subscribe
            if (prev.some(x => x.id === m.id)) return prev;
            return [...prev, m];
          });
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [id]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || !id) return;

    setSending(true);
    setError(null);

    // Optimistic update — will be swapped out by the realtime handler
    const optimistic: Message = {
      id: `opt-${Date.now()}`,
      conversation_id: id,
      direction: 'out',
      content: trimmed,
      message_type: 'text',
      sent_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    setText('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API}/api/whatsapp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ conversationId: id, text: trimmed }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message ?? 'Erro ao enviar mensagem');
      }
      // Success — realtime will replace the optimistic entry when the DB row arrives.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setText(trimmed);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleShare = async () => {
    if (!conv || sharing) return;
    setSharing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API}/api/conversations/${conv.id}/share`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message ?? 'Erro ao compartilhar');
      }
      const result = await res.json() as { status: string };
      setConv(prev => prev ? { ...prev, status: result.status } : prev);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSharing(false);
    }
  };

  const handleDelegate = async () => {
    if (!conv || (!delegateSectorId && !delegateUserId)) return;
    setDelegating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API}/api/conversations/${conv.id}/delegate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          sectorId: delegateSectorId || undefined,
          assignedTo: delegateUserId || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message ?? 'Erro ao delegar');
      }
      setShowDelegate(false);
      const { data: updated } = await supabase
        .from('conversations')
        .select('id, contact_number, contact_name, status, municipality')
        .eq('id', conv.id)
        .single();
      if (updated) setConv(updated as Conversation);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setDelegating(false);
    }
  };

  const handleSaveInfo = async () => {
    if (!conv || savingInfo) return;
    setSavingInfo(true);
    try {
      const { error: upErr } = await supabase
        .from('conversations')
        .update({
          contact_name: editName.trim() || null,
          municipality: editMunicipality.trim() || null,
        })
        .eq('id', conv.id);
      if (upErr) throw new Error(upErr.message);
      setConv(prev => prev ? {
        ...prev,
        contact_name: editName.trim() || null,
        municipality: editMunicipality.trim() || null,
      } : prev);
      setShowInfo(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSavingInfo(false);
    }
  };

  // Group messages by date
  const grouped: { date: string; msgs: Message[] }[] = [];
  for (const m of messages) {
    const date = fmtDate(m.sent_at);
    const last = grouped[grouped.length - 1];
    if (last?.date === date) {
      last.msgs.push(m);
    } else {
      grouped.push({ date, msgs: [m] });
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
      background: 'var(--ammoc-paper-2)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 20px',
        background: 'var(--ammoc-paper)',
        borderBottom: '1px solid var(--ammoc-line-2)',
        flexShrink: 0,
      }}>
        <button
          onClick={() => router.back()}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--ammoc-ink-600)', fontSize: 20, padding: 4,
            display: 'flex', alignItems: 'center',
          }}
          aria-label="Voltar"
        >
          ←
        </button>

        {/* Avatar */}
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: 'var(--ammoc-green-100)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, flexShrink: 0, fontWeight: 700,
          color: 'var(--ammoc-green-800)',
        }}>
          {(conv?.contact_name ?? conv?.contact_number ?? '?')[0].toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 700, fontSize: 15, color: 'var(--ammoc-ink-900)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {conv?.contact_name || conv?.contact_number || '...'}
          </div>
          {conv?.municipality && (
            <div style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
              {conv.municipality}
            </div>
          )}
        </div>

        {/* Header actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* Share button (only for nao_salva) or status badge */}
          {conv?.status === 'nao_salva' ? (
            <button
              onClick={() => void handleShare()}
              disabled={sharing}
              style={{
                background: sharing ? 'var(--ammoc-line)' : 'var(--ammoc-green)',
                color: 'white', border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '5px 12px', fontSize: 12, fontWeight: 600,
                cursor: sharing ? 'default' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {sharing ? 'Compartilhando...' : '🔗 Compartilhar'}
            </button>
          ) : (
            <div style={{
              fontSize: 11, fontWeight: 700,
              padding: '2px 10px', borderRadius: 99,
              background: conv?.status === 'ativa' ? 'var(--ammoc-green-100)' : 'var(--ammoc-paper-3)',
              color: conv?.status === 'ativa' ? 'var(--ammoc-green-800)' : 'var(--ammoc-ink-400)',
              whiteSpace: 'nowrap',
            }}>
              {conv?.status ?? '—'}
            </div>
          )}

          {/* Delegate button */}
          <button
            onClick={() => setShowDelegate(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'var(--ammoc-paper-2)',
              border: '1.5px solid var(--ammoc-line)',
              color: 'var(--ammoc-ink-700)',
              borderRadius: 'var(--radius-sm)',
              padding: '5px 12px', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            🏛️ Delegar
          </button>

          {/* Contact info toggle */}
          <button
            onClick={() => setShowInfo(v => !v)}
            style={{
              background: showInfo ? 'var(--ammoc-green-100)' : 'var(--ammoc-paper-2)',
              color: showInfo ? 'var(--ammoc-green-800)' : 'var(--ammoc-ink-600)',
              border: '1px solid var(--ammoc-line-2)',
              borderRadius: 'var(--radius-sm)',
              padding: '5px 12px', fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            aria-label="Informações do contato"
          >
            ℹ️ Contato
          </button>
        </div>
      </div>

      {/* Contact info panel — slides in below the header */}
      {showInfo && (
        <div style={{
          background: 'var(--ammoc-paper)',
          borderBottom: '2px solid var(--ammoc-line-2)',
          padding: '16px 20px',
          flexShrink: 0,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '12px 16px',
        }}>
          {/* Telefone (read-only) */}
          <div>
            <label style={{
              display: 'block', fontSize: 11, fontWeight: 700,
              color: 'var(--ammoc-ink-400)', marginBottom: 4,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              Telefone
            </label>
            <div style={{
              padding: '8px 12px',
              background: 'var(--ammoc-paper-2)',
              border: '1.5px solid var(--ammoc-line)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 14, color: 'var(--ammoc-ink-600)',
            }}>
              {conv?.contact_number ?? '—'}
            </div>
          </div>

          {/* Nome (editable) */}
          <div>
            <label style={{
              display: 'block', fontSize: 11, fontWeight: 700,
              color: 'var(--ammoc-ink-400)', marginBottom: 4,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              Nome
            </label>
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="Nome do contato"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '8px 12px',
                border: '1.5px solid var(--ammoc-line)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 14, outline: 'none',
                background: 'var(--ammoc-paper)',
                color: 'var(--ammoc-ink-900)',
              }}
            />
          </div>

          {/* Município (editable) */}
          <div>
            <label style={{
              display: 'block', fontSize: 11, fontWeight: 700,
              color: 'var(--ammoc-ink-400)', marginBottom: 4,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              Município
            </label>
            <input
              value={editMunicipality}
              onChange={e => setEditMunicipality(e.target.value)}
              placeholder="Município"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '8px 12px',
                border: '1.5px solid var(--ammoc-line)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 14, outline: 'none',
                background: 'var(--ammoc-paper)',
                color: 'var(--ammoc-ink-900)',
              }}
            />
          </div>

          {/* Save / Cancel */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <button
              onClick={() => void handleSaveInfo()}
              disabled={savingInfo}
              style={{
                background: savingInfo ? 'var(--ammoc-line)' : 'var(--ammoc-green)',
                color: 'white', border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 16px', fontSize: 13, fontWeight: 600,
                cursor: savingInfo ? 'default' : 'pointer',
                flex: 1,
              }}
            >
              {savingInfo ? 'Salvando...' : '💾 Salvar'}
            </button>
            <button
              onClick={() => {
                setEditName(conv?.contact_name ?? '');
                setEditMunicipality(conv?.municipality ?? '');
                setShowInfo(false);
              }}
              style={{
                background: 'var(--ammoc-paper-2)',
                color: 'var(--ammoc-ink-600)',
                border: '1px solid var(--ammoc-line-2)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 16px', fontSize: 13, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Messages area */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px 20px',
        display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <div style={{
              width: 28, height: 28, border: '3px solid var(--ammoc-line-2)',
              borderTopColor: 'var(--ammoc-green)', borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : messages.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', flex: 1, gap: 8,
            color: 'var(--ammoc-ink-400)', fontSize: 14,
          }}>
            <span style={{ fontSize: 36 }}>💬</span>
            <span>Nenhuma mensagem ainda</span>
          </div>
        ) : (
          grouped.map(group => (
            <div key={group.date}>
              {/* Date divider */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                margin: '12px 0 8px',
              }}>
                <div style={{ flex: 1, height: 1, background: 'var(--ammoc-line-2)' }} />
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  color: 'var(--ammoc-ink-400)',
                  padding: '2px 10px',
                  background: 'var(--ammoc-paper-3)',
                  borderRadius: 99,
                }}>
                  {group.date}
                </span>
                <div style={{ flex: 1, height: 1, background: 'var(--ammoc-line-2)' }} />
              </div>

              {/* Message bubbles */}
              {group.msgs.map(m => (
                <div
                  key={m.id}
                  style={{
                    display: 'flex',
                    justifyContent: m.direction === 'out' ? 'flex-end' : 'flex-start',
                    marginBottom: 4,
                  }}
                >
                  <div style={{
                    maxWidth: '70%',
                    background: m.direction === 'out' ? 'var(--ammoc-green)' : 'var(--ammoc-paper)',
                    color: m.direction === 'out' ? 'white' : 'var(--ammoc-ink-900)',
                    borderRadius: m.direction === 'out'
                      ? '16px 16px 4px 16px'
                      : '16px 16px 16px 4px',
                    padding: '8px 12px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                    border: m.direction === 'in' ? '1px solid var(--ammoc-line-2)' : 'none',
                    opacity: m.id.startsWith('opt-') ? 0.65 : 1,
                    transition: 'opacity 0.25s',
                  }}>
                    <div style={{ fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word' }}>
                      {m.content}
                    </div>
                    <div style={{
                      fontSize: 10,
                      color: m.direction === 'out' ? 'rgba(255,255,255,0.7)' : 'var(--ammoc-ink-400)',
                      textAlign: 'right',
                      marginTop: 2,
                    }}>
                      {fmtTime(m.sent_at)}
                      {m.id.startsWith('opt-') && ' ○'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          padding: '8px 20px',
          background: '#fef2f2',
          borderTop: '1px solid #fecaca',
          color: '#dc2626',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#dc2626' }}
          >
            ×
          </button>
        </div>
      )}

      {/* Input area */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 10,
        padding: '12px 16px',
        background: 'var(--ammoc-paper)',
        borderTop: '1px solid var(--ammoc-line-2)',
        flexShrink: 0,
      }}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Digite uma mensagem... (Enter para enviar)"
          rows={1}
          style={{
            flex: 1,
            border: '1.5px solid var(--ammoc-line)',
            borderRadius: 20,
            padding: '9px 14px',
            fontSize: 14,
            outline: 'none',
            resize: 'none',
            background: 'var(--ammoc-paper)',
            color: 'var(--ammoc-ink-900)',
            fontFamily: 'var(--font-body)',
            maxHeight: 120,
            overflowY: 'auto',
            lineHeight: 1.5,
          }}
          onInput={e => {
            const el = e.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
          }}
        />
        <button
          onClick={() => void handleSend()}
          disabled={!text.trim() || sending}
          style={{
            width: 42, height: 42, borderRadius: '50%',
            background: !text.trim() || sending ? 'var(--ammoc-line)' : 'var(--ammoc-green)',
            color: 'white',
            border: 'none',
            cursor: !text.trim() || sending ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, flexShrink: 0,
            transition: 'background 0.15s',
          }}
          aria-label="Enviar"
        >
          {sending ? (
            <div style={{
              width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)',
              borderTopColor: 'white', borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
          ) : '➤'}
        </button>
      </div>

      {/* Delegation modal */}
      {showDelegate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--ammoc-paper)', borderRadius: 'var(--radius)', padding: 28, width: 400, boxShadow: '0 8px 32px rgba(0,0,0,.2)' }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 800 }}>Delegar conversa</h2>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ammoc-ink-600)', display: 'block', marginBottom: 4 }}>Setor</label>
              <select value={delegateSectorId} onChange={e => setDelegateSectorId(e.target.value)}
                style={{ width: '100%', border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 13, boxSizing: 'border-box' }}>
                <option value="">Selecione um setor…</option>
                {sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {sectorUsers.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ammoc-ink-600)', display: 'block', marginBottom: 4 }}>Funcionário (opcional)</label>
                <select value={delegateUserId} onChange={e => setDelegateUserId(e.target.value)}
                  style={{ width: '100%', border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 13, boxSizing: 'border-box' }}>
                  <option value="">Qualquer membro do setor</option>
                  {sectorUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowDelegate(false)} style={{ background: 'var(--ammoc-paper-2)', border: '1px solid var(--ammoc-line)', color: 'var(--ammoc-ink-600)', borderRadius: 'var(--radius-sm)', padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={() => void handleDelegate()} disabled={delegating || (!delegateSectorId && !delegateUserId)}
                style={{ background: 'var(--ammoc-green)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: delegating ? 'default' : 'pointer', opacity: (!delegateSectorId && !delegateUserId) ? 0.5 : 1 }}>
                {delegating ? 'Delegando…' : 'Confirmar delegação'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
