'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getApiBase } from '@/lib/api-base';
import { useIsMobile } from '@/lib/use-is-mobile';
import type { CanalConversationStatus } from '@crmwhats/types';
import { CanalPanel } from './CanalPanel';

const API = getApiBase();

// Row shape from GET /api/canal/conversations (joined canal_numbers)
interface CanalConvRow {
  id: string;
  canal_number_id: string;
  wa_contact_number: string;
  wa_contact_name: string | null;
  sector_id: string | null;
  suggested_sector_id: string | null;
  assigned_to: string | null;
  status: CanalConversationStatus;
  subject: string | null;
  municipality: string | null;
  last_message_at: string | null;
  canal_numbers: { label: string; display_number: string } | null;
}

type FilterTab = 'todas' | 'open' | 'human' | 'closed';

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'open', label: 'Aguardando' },
  { key: 'human', label: 'Em atendimento' },
  { key: 'closed', label: 'Encerradas' },
];

const STATUS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  open: { label: 'Aguardando', bg: '#fef3c7', color: '#92400e' },
  human: { label: 'Em atendimento', bg: 'var(--ammoc-green-100)', color: 'var(--ammoc-green-800)' },
  closed: { label: 'Encerrada', bg: 'var(--ammoc-paper-3)', color: 'var(--ammoc-ink-400)' },
};

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', fontSize: 12, fontWeight: active ? 700 : 500,
  color: active ? 'var(--ammoc-green-700)' : 'var(--ammoc-ink-400)',
  borderBottom: active ? '2px solid var(--ammoc-green)' : '2px solid transparent',
  background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)',
});

function fmtTime(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  if (diffH < 24 * 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export default function CanalPage() {
  const supabase = useMemo(() => createClient(), []);
  const isMobile = useIsMobile();
  const [token, setToken] = useState<string | null>(null);
  const [conversations, setConversations] = useState<CanalConvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterTab>('todas');
  const [search, setSearch] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadConversations = useCallback(async (tok: string) => {
    setError(null);
    try {
      const res = await fetch(`${API}/api/canal/conversations`, { headers: { Authorization: `Bearer ${tok}` } });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as CanalConvRow[];
      setConversations(data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar conversas');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token ?? null;
      setToken(tok);
      if (tok) {
        await loadConversations(tok);
        const iv = setInterval(() => { void loadConversations(tok); }, 5000);
        return () => clearInterval(iv);
      }
      setLoading(false);
    })();
  }, [supabase, loadConversations]);

  const filtered = conversations.filter(c => {
    if (tab !== 'todas' && c.status !== tab) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return (c.wa_contact_name ?? '').toLowerCase().includes(q) || c.wa_contact_number.includes(q);
  });

  const selected = conversations.find(c => c.id === selectedId) ?? null;

  return (
    <div style={{ padding: isMobile ? 16 : 32, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--ammoc-ink-900)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
        Canal AMMOC
      </h1>
      <p style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, margin: '0 0 16px' }}>
        Mensagens recebidas pelos números oficiais da AMMOC.
      </p>

      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0, height: isMobile ? 'calc(100dvh - 140px)' : 'calc(100vh - 180px)' }}>
        {/* LEFT — conversation list */}
        <div style={{ width: isMobile ? '100%' : 380, flexShrink: isMobile ? 1 : 0, display: isMobile && selectedId ? 'none' : 'flex', flexDirection: 'column', background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px 0', borderBottom: '1px solid var(--ammoc-line-2)', background: 'var(--ammoc-paper-2)' }}>
            <input
              type="text"
              placeholder="🔍  Pesquisar conversa..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '7px 12px', fontSize: 13, outline: 'none', color: 'var(--ammoc-ink-900)', boxSizing: 'border-box', marginBottom: 8 }}
            />
            <div style={{ display: 'flex', gap: 2, overflowX: 'auto' }}>
              {TABS.map(t => (
                <button key={t.key} type="button" style={tabBtn(tab === t.key)} onClick={() => setTab(t.key)}>{t.label}</button>
              ))}
            </div>
          </div>

          {error && (
            <div style={{ padding: '10px 16px', fontSize: 13, color: '#b91c1c', background: '#fef2f2', borderBottom: '1px solid #fca5a5' }}>{error}</div>
          )}

          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {loading ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ammoc-ink-400)', fontSize: 13 }}>Carregando conversas…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--ammoc-ink-400)' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📡</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Nenhuma conversa</div>
                <div style={{ fontSize: 12 }}>As mensagens recebidas pelos números da AMMOC aparecerão aqui.</div>
              </div>
            ) : (
              filtered.map(conv => {
                const name = conv.wa_contact_name || conv.wa_contact_number;
                const initials = name.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
                const badge = STATUS_BADGE[conv.status] ?? STATUS_BADGE.open;
                const isHovered = hoveredId === conv.id;
                return (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedId(conv.id)}
                    onMouseEnter={() => setHoveredId(conv.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                      borderBottom: '1px solid var(--ammoc-line-2)',
                      background: selectedId === conv.id ? 'var(--ammoc-green-100)' : (isHovered ? 'var(--ammoc-paper-2)' : 'transparent'),
                      transition: 'background 0.1s', cursor: 'pointer',
                    }}
                  >
                    <div style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, background: 'var(--ammoc-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 15, fontWeight: 700 }}>
                      {initials || '?'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ammoc-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{name}</span>
                        <span style={{ fontSize: 11, color: 'var(--ammoc-ink-400)', flexShrink: 0, whiteSpace: 'nowrap' }}>{fmtTime(conv.last_message_at)}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {conv.canal_numbers?.label && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: 'var(--ammoc-paper-3)', color: 'var(--ammoc-ink-600)' }}>
                            📡 {conv.canal_numbers.label}
                          </span>
                        )}
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: badge.bg, color: badge.color }}>
                          {badge.label}
                        </span>
                      </div>
                      {(conv.municipality || conv.subject) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 3, fontSize: 11, color: 'var(--ammoc-ink-400)' }}>
                          {conv.municipality && <span>📍 {conv.municipality}</span>}
                          {conv.subject && <span>🏷️ {conv.subject}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT — panel */}
        <div style={{ flex: 1, minWidth: 0, display: isMobile && !selectedId ? 'none' : 'flex', border: '1px solid var(--ammoc-line-2)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--ammoc-paper)' }}>
          {selected ? (
            <CanalPanel
              key={selected.id}
              conversationId={selected.id}
              contactName={selected.wa_contact_name || selected.wa_contact_number}
              contactNumber={selected.wa_contact_number}
              numberLabel={selected.canal_numbers?.label ?? ''}
              status={selected.status}
              subject={selected.subject}
              municipality={selected.municipality}
              suggestedSectorId={selected.suggested_sector_id}
              token={token}
              onBack={() => setSelectedId(null)}
              onChanged={() => { if (token) void loadConversations(token); }}
            />
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ammoc-ink-400)', fontSize: 14, flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 40 }}>📡</div>
              Selecione uma conversa
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
