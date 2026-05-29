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

      if (convData) setConv(convData as Conversation);
      if (msgData) setMessages(msgData as Message[]);
      setLoading(false);
    })();
  }, [id]);

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
            // Avoid duplicates (optimistic + realtime)
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

    // Optimistic update
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      // Roll back optimistic message
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

        <div style={{
          fontSize: 11, fontWeight: 700,
          padding: '2px 10px', borderRadius: 99,
          background: conv?.status === 'ativa' ? 'var(--ammoc-green-100)' : 'var(--ammoc-paper-3)',
          color: conv?.status === 'ativa' ? 'var(--ammoc-green-800)' : 'var(--ammoc-ink-400)',
        }}>
          {conv?.status ?? '—'}
        </div>
      </div>

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
                    opacity: m.id.startsWith('opt-') ? 0.7 : 1,
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
    </div>
  );
}
