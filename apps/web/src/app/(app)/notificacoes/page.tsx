'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// ─── Types ───────────────────────────────────────────────────────────────────

type EventType = 'conversation' | 'transfer' | 'closed';

interface FeedEvent {
  id: string;
  type: EventType;
  description: string;
  ts: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(ts: string) {
  const d = new Date(ts);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const EVENT_ICON: Record<EventType, string> = {
  conversation: '💬',
  transfer: '↔️',
  closed: '✅',
};

const EVENT_BG: Record<EventType, string> = {
  conversation: '#EFF6FF',
  transfer:     '#FEF3C7',
  closed:       '#E6F0E5',
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function NotificacoesPage() {
  const supabase = createClient();

  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [convsRes, transfersRes, closedRes] = await Promise.all([
          supabase
            .from('conversations')
            .select('id, contact_name, contact_number, status, municipality, created_at, last_message_at')
            .order('last_message_at', { ascending: false })
            .limit(10),

          supabase
            .from('attendance_transfers')
            .select('id, note, transferred_at, from_user:users!from_user_id(name), to_user:users!to_user_id(name)')
            .order('transferred_at', { ascending: false })
            .limit(10),

          supabase
            .from('attendances')
            .select('id, closed_at, municipality, conversation:conversations(contact_name)')
            .eq('status', 'encerrado')
            .not('closed_at', 'is', null)
            .order('closed_at', { ascending: false })
            .limit(10),
        ]);

        if (convsRes.error) throw convsRes.error;
        if (transfersRes.error) throw transfersRes.error;
        if (closedRes.error) throw closedRes.error;

        const feed: FeedEvent[] = [];

        // New conversations
        for (const c of (convsRes.data ?? []) as Array<{
          id: string; contact_name: string; contact_number: string;
          municipality: string | null; last_message_at: string | null; created_at: string;
        }>) {
          const ts = c.last_message_at ?? c.created_at;
          feed.push({
            id: `conv-${c.id}`,
            type: 'conversation',
            description: `Nova conversa com ${c.contact_name || c.contact_number}${c.municipality ? ` em ${c.municipality}` : ''}`,
            ts,
          });
        }

        // Transfers
        for (const t of (transfersRes.data ?? []) as unknown as Array<{
          id: string; note: string | null; transferred_at: string;
          from_user: { name: string } | null; to_user: { name: string } | null;
        }>) {
          const from = t.from_user?.name ?? 'Desconhecido';
          const to = t.to_user?.name ?? 'Desconhecido';
          const note = t.note ? t.note : 'sem nota';
          feed.push({
            id: `transfer-${t.id}`,
            type: 'transfer',
            description: `${from} transferiu para ${to} — ${note}`,
            ts: t.transferred_at,
          });
        }

        // Closed attendances
        for (const a of (closedRes.data ?? []) as unknown as Array<{
          id: string; closed_at: string;
          conversation: { contact_name: string } | null;
        }>) {
          const name = a.conversation?.contact_name ?? 'contato desconhecido';
          feed.push({
            id: `closed-${a.id}`,
            type: 'closed',
            description: `Atendimento de ${name} encerrado`,
            ts: a.closed_at,
          });
        }

        // Sort newest first
        feed.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

        setEvents(feed);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar notificações.');
      } finally {
        setLoading(false);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: '32px', flex: 1 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800,
          color: 'var(--ammoc-ink-900)', margin: 0, letterSpacing: '-0.02em' }}>
          Notificações
        </h1>
        <p style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, margin: '4px 0 0' }}>
          Feed de atividade recente do sistema.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: '#FCEBE8', color: '#C0392B', padding: '10px 14px',
          borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Timeline */}
      <div style={{ background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)',
        borderRadius: 'var(--radius)', padding: 20 }}>
        {loading ? (
          <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
            Carregando…
          </div>
        ) : events.length === 0 ? (
          <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
            Nenhuma atividade recente.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {events.map((ev, idx) => (
              <div key={ev.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 14,
                padding: '12px 0',
                borderBottom: idx < events.length - 1 ? '1px solid var(--ammoc-line-2)' : 'none',
              }}>
                {/* Icon bubble */}
                <div style={{
                  width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                  background: EVENT_BG[ev.type],
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16,
                }}>
                  {EVENT_ICON[ev.type]}
                </div>

                {/* Text */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--ammoc-ink-900)', fontWeight: 500,
                    lineHeight: 1.4 }}>
                    {ev.description}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ammoc-ink-400)', marginTop: 3 }}>
                    {fmtTime(ev.ts)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
