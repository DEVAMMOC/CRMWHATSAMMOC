'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getApiBase } from '@/lib/api-base';
import { useIsMobile } from '@/lib/use-is-mobile';
import type { CanalConversationStatus } from '@crmwhats/types';

const API = getApiBase();

interface KanbanConv {
  id: string;
  canal_number_id: string;
  wa_contact_number: string;
  wa_contact_name: string | null;
  sector_id: string | null;
  assigned_to: string | null;
  status: CanalConversationStatus;
  subject: string | null;
  municipality: string | null;
  last_message_at: string | null;
  closed_at: string | null;
  canal_numbers: { label: string } | null;
}

interface Sector {
  id: string;
  name: string;
  color: string;
}

type ColStatus = 'open' | 'human' | 'closed';

const COLUMNS: { status: ColStatus; title: string; accent: string }[] = [
  { status: 'open', title: 'Aguardando', accent: '#d97706' },
  { status: 'human', title: 'Em atendimento', accent: 'var(--ammoc-green)' },
  { status: 'closed', title: 'Finalizada', accent: 'var(--ammoc-ink-400)' },
];

const STATUS_LABEL: Record<ColStatus, string> = {
  open: 'Aguardando',
  human: 'Em atendimento',
  closed: 'Finalizada',
};

function fmtTime(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export default function KanbanPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const isMobile = useIsMobile();

  const [conversations, setConversations] = useState<KanbanConv[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<ColStatus | null>(null);

  // Lê DIRETO via Supabase client → RLS aplica o escopo por papel automaticamente.
  const loadData = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('canal_conversations')
      .select('*, canal_numbers(label)')
      .order('last_message_at', { ascending: false });
    if (err) {
      setError(err.message);
    } else {
      setConversations((data as unknown as KanbanConv[]) ?? []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      await loadData();
      const { data: sectorData } = await supabase
        .from('sectors')
        .select('id, name, color')
        .order('name');
      setSectors((sectorData ?? []) as Sector[]);
    })();
  }, [loadData, supabase]);

  const changeStatus = useCallback(
    async (id: string, status: ColStatus) => {
      const prev = conversations;
      // Optimista: move o card já.
      setConversations(cs =>
        cs.map(c =>
          c.id === id
            ? { ...c, status, closed_at: status === 'closed' ? new Date().toISOString() : null }
            : c,
        ),
      );
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${API}/api/canal/conversations/${id}/status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token ?? ''}`,
          },
          body: JSON.stringify({ status }),
        });
        if (!res.ok) throw new Error(await res.text());
        await loadData();
      } catch (e) {
        // Reverte em caso de erro.
        setConversations(prev);
        setError(e instanceof Error ? e.message : 'Erro ao mudar status');
      }
    },
    [conversations, supabase, loadData],
  );

  const assumeConversation = useCallback(
    async (id: string) => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${API}/api/canal/conversations/${id}/assume`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
        });
        if (!res.ok) throw new Error(await res.text());
        await loadData();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao assumir conversa');
      }
    },
    [supabase, loadData],
  );

  const filtered = conversations.filter(c => {
    const matchSector = !sectorFilter || c.sector_id === sectorFilter;
    const q = search.toLowerCase().trim();
    const matchSearch =
      !q ||
      (c.wa_contact_name ?? '').toLowerCase().includes(q) ||
      c.wa_contact_number.toLowerCase().includes(q);
    return matchSector && matchSearch;
  });

  const byStatus = (s: ColStatus) => filtered.filter(c => c.status === s);

  const Card = ({ conv }: { conv: KanbanConv }) => {
    const name = conv.wa_contact_name || conv.wa_contact_number;
    const sec = conv.sector_id ? sectors.find(s => s.id === conv.sector_id) : null;
    return (
      <div
        draggable={!isMobile}
        onDragStart={e => {
          setDraggingId(conv.id);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', conv.id);
        }}
        onDragEnd={() => { setDraggingId(null); setDragOverCol(null); }}
        onClick={() => router.push('/canal')}
        style={{
          background: 'var(--ammoc-paper)',
          border: '1px solid var(--ammoc-line-2)',
          borderRadius: 'var(--radius)',
          padding: 12,
          marginBottom: 8,
          boxShadow: 'var(--shadow-card)',
          cursor: isMobile ? 'pointer' : 'grab',
          opacity: draggingId === conv.id ? 0.5 : 1,
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--ammoc-green)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--ammoc-line-2)'; }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: 'var(--ammoc-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 13, fontWeight: 700 }}>
            {(name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase().slice(0, 2)) || '?'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ammoc-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>
              {conv.wa_contact_number}
            </div>
          </div>
          <span style={{ fontSize: 10, color: 'var(--ammoc-ink-400)', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {fmtTime(conv.last_message_at)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {conv.canal_numbers?.label && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: 'var(--ammoc-paper-3)', color: 'var(--ammoc-ink-600)' }}>
              📡 {conv.canal_numbers.label}
            </span>
          )}
          {sec && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: sec.color + '22', color: sec.color, border: `1px solid ${sec.color}44` }}>
              🏛️ {sec.name}
            </span>
          )}
          {conv.assigned_to && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: 'var(--ammoc-green-100)', color: 'var(--ammoc-green-800)' }}>
              👤 Atribuído
            </span>
          )}
        </div>

        {(conv.municipality || conv.subject) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8, fontSize: 11, color: 'var(--ammoc-ink-400)' }}>
            {conv.municipality && <span>📍 {conv.municipality}</span>}
            {conv.subject && <span>🏷️ {conv.subject}</span>}
          </div>
        )}

        {conv.status === 'open' && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); void assumeConversation(conv.id); }}
            style={{
              width: '100%', fontSize: 11, fontWeight: 700, padding: '5px 6px', marginBottom: 8,
              borderRadius: 'var(--radius-sm)', border: '1px solid var(--ammoc-green)',
              background: 'var(--ammoc-green-100)', color: 'var(--ammoc-green-800)',
              cursor: 'pointer', boxSizing: 'border-box',
            }}
          >
            ✋ Assumir
          </button>
        )}

        {/* Fallback de mudança de status (mobile / sem drag) */}
        <select
          value={conv.status}
          onClick={e => e.stopPropagation()}
          onChange={e => { e.stopPropagation(); void changeStatus(conv.id, e.target.value as ColStatus); }}
          style={{
            width: '100%', fontSize: 11, padding: '4px 6px', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--ammoc-line)', background: 'var(--ammoc-paper-2)',
            color: 'var(--ammoc-ink-700)', outline: 'none', cursor: 'pointer', boxSizing: 'border-box',
          }}
        >
          {COLUMNS.map(col => (
            <option key={col.status} value={col.status}>{STATUS_LABEL[col.status]}</option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <div style={{ padding: isMobile ? 16 : 32, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--ammoc-ink-900)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
        Kanban de Atendimento
      </h1>
      <p style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, margin: '0 0 16px' }}>
        Conversas do Canal AMMOC organizadas por status. Arraste os cards entre as colunas para mudar o status.
      </p>

      {/* Busca */}
      <input
        type="text"
        placeholder="🔍  Buscar por contato..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          width: '100%', border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)',
          padding: '9px 12px', fontSize: 14, outline: 'none', marginBottom: 16,
          background: 'var(--ammoc-paper)', color: 'var(--ammoc-ink-900)', boxSizing: 'border-box',
        }}
      />

      {/* Filtro de setor */}
      {sectors.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--ammoc-ink-400)', fontWeight: 600 }}>Setor:</span>
          <button onClick={() => setSectorFilter(null)}
            style={{ padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: !sectorFilter ? 'var(--ammoc-ink-700)' : 'var(--ammoc-paper-2)', color: !sectorFilter ? 'white' : 'var(--ammoc-ink-500)' }}>
            Todos
          </button>
          {sectors.map(s => (
            <button key={s.id} onClick={() => setSectorFilter(sectorFilter === s.id ? null : s.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: sectorFilter === s.id ? s.color : 'var(--ammoc-paper-2)', color: sectorFilter === s.id ? 'white' : 'var(--ammoc-ink-500)', transition: 'all 0.15s' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: sectorFilter === s.id ? 'rgba(255,255,255,0.6)' : s.color }} />
              {s.name}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: 16, background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <div style={{ width: 32, height: 32, border: '3px solid var(--ammoc-line-2)', borderTopColor: 'var(--ammoc-green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : (
        <div style={{
          display: isMobile ? 'flex' : 'grid',
          flexDirection: isMobile ? 'column' : undefined,
          gridTemplateColumns: isMobile ? undefined : 'repeat(3, 1fr)',
          gap: 12, flex: 1, minHeight: 0,
        }}>
          {COLUMNS.map(col => {
            const cards = byStatus(col.status);
            const isOver = dragOverCol === col.status;
            return (
              <div
                key={col.status}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCol(col.status); }}
                onDragLeave={() => setDragOverCol(prev => (prev === col.status ? null : prev))}
                onDrop={e => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/plain') || draggingId;
                  setDragOverCol(null);
                  setDraggingId(null);
                  const conv = conversations.find(c => c.id === id);
                  if (id && conv && conv.status !== col.status) void changeStatus(id, col.status);
                }}
                style={{
                  background: isOver ? 'var(--ammoc-green-100)' : 'var(--ammoc-paper-2)',
                  border: `1.5px ${isOver ? 'dashed var(--ammoc-green)' : 'solid var(--ammoc-line-2)'}`,
                  borderRadius: 'var(--radius)',
                  padding: 12,
                  display: 'flex', flexDirection: 'column', minHeight: isMobile ? 0 : 200,
                  transition: 'background 0.15s, border-color 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: col.accent }} />
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ammoc-ink-900)' }}>{col.title}</span>
                  <span style={{ background: 'var(--ammoc-paper-3)', color: 'var(--ammoc-ink-600)', fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 99 }}>
                    {cards.length}
                  </span>
                </div>
                <div style={{ flex: 1, overflowY: isMobile ? 'visible' : 'auto', minHeight: 0 }}>
                  {cards.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--ammoc-ink-400)', fontSize: 12, padding: '24px 8px' }}>
                      Nenhuma conversa
                    </div>
                  ) : (
                    cards.map(conv => <Card key={conv.id} conv={conv} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
