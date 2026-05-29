'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type ConversationStatus = 'nao_salva' | 'pendente' | 'ativa' | 'encerrada';

interface Conversation {
  id: string;
  owner_user_id: string;
  contact_number: string;
  contact_name: string | null;
  status: ConversationStatus;
  source: 'pessoal' | 'bot';
  municipality: string | null;
  trigger_keywords: string[] | null;
  last_message_at: string | null;
  last_synced_at: string | null;
  created_at: string;
}

type StatusFilter = 'all' | 'pendente' | 'ativa' | 'encerrada';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    nao_salva:    { label: 'Não salva',    bg: 'var(--ammoc-paper-3)',   color: 'var(--ammoc-ink-400)' },
    pendente:     { label: 'Pendente',     bg: 'var(--color-yellow-bg)', color: 'var(--color-yellow)' },
    ativa:        { label: 'Ativa',        bg: 'var(--ammoc-green-100)', color: 'var(--ammoc-green-800)' },
    encerrada:    { label: 'Encerrada',    bg: 'var(--ammoc-line-2)',    color: 'var(--ammoc-ink-400)' },
    aberto:       { label: 'Aberto',       bg: 'var(--color-blue-bg)',   color: 'var(--color-blue)' },
    em_andamento: { label: 'Em andamento', bg: 'var(--color-yellow-bg)', color: 'var(--color-yellow)' },
    transferido:  { label: 'Transferido',  bg: 'var(--ammoc-green-100)', color: 'var(--ammoc-green-800)' },
    encerrado:    { label: 'Encerrado',    bg: 'var(--ammoc-line-2)',    color: 'var(--ammoc-ink-400)' },
  };
  const s = map[status] ?? { label: status, bg: 'var(--ammoc-line-2)', color: 'var(--ammoc-ink-400)' };
  return (
    <span style={{
      background: s.bg, color: s.color, fontSize: 11, fontWeight: 700,
      padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

function fmtTime(ts: string | null) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

export default function DashboardPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const supabase = createClient();
  const router = useRouter();

  const loadData = useCallback(async (userId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .order('last_message_at', { ascending: false });

    if (error) {
      console.error('Error loading conversations:', error);
    } else {
      setConversations((data as Conversation[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
        await loadData(user.id);
      } else {
        setLoading(false);
      }
    })();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API}/api/whatsapp/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
      });
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        throw new Error(err.message ?? `HTTP ${res.status}`);
      }
      const result = await res.json() as { synced: number };
      // Reload conversation list after sync
      if (currentUserId) await loadData(currentUserId);
      alert(`Sincronizado! ${result.synced} contato(s) importado(s).`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert('Erro ao sincronizar: ' + msg);
    } finally {
      setSyncing(false);
    }
  };

  const handleAccept = async (conv: Conversation) => {
    if (!currentUserId) return;
    setAcceptingId(conv.id);
    try {
      const { error: attError } = await supabase.from('attendances').insert({
        conversation_id: conv.id,
        assigned_to: currentUserId,
        status: 'aberto',
        municipality: conv.municipality,
        opened_at: new Date().toISOString(),
      });
      if (attError) throw attError;

      const { error: convError } = await supabase
        .from('conversations')
        .update({ status: 'ativa' })
        .eq('id', conv.id);
      if (convError) throw convError;

      setConversations(prev =>
        prev.map(c => c.id === conv.id ? { ...c, status: 'ativa' } : c)
      );
      alert('Conversa aceita com sucesso!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert('Erro ao aceitar conversa: ' + msg);
    } finally {
      setAcceptingId(null);
    }
  };

  const filtered = conversations.filter(c => {
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    const term = searchTerm.toLowerCase();
    const matchSearch =
      !term ||
      (c.contact_name ?? '').toLowerCase().includes(term) ||
      c.contact_number.toLowerCase().includes(term) ||
      (c.municipality ?? '').toLowerCase().includes(term);
    return matchStatus && matchSearch;
  });

  const counts: Record<StatusFilter, number> = {
    all: conversations.length,
    pendente: conversations.filter(c => c.status === 'pendente').length,
    ativa: conversations.filter(c => c.status === 'ativa').length,
    encerrada: conversations.filter(c => c.status === 'encerrada').length,
  };

  const tabs: { key: StatusFilter; label: string }[] = [
    { key: 'all',      label: 'Todas' },
    { key: 'pendente', label: 'Pendentes' },
    { key: 'ativa',    label: 'Ativas' },
    { key: 'encerrada',label: 'Encerradas' },
  ];

  return (
    <div style={{ padding: 32, flex: 1, minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800,
          color: 'var(--ammoc-ink-900)', margin: 0, letterSpacing: '-0.02em',
        }}>
          Conversas
        </h1>
        <span style={{
          background: 'var(--ammoc-paper-3)', color: 'var(--ammoc-ink-600)',
          fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 99,
        }}>
          {conversations.length}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void handleSync()}
          disabled={syncing}
          title="Importar todos os contatos do WhatsApp"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: syncing ? 'var(--ammoc-line)' : 'var(--ammoc-paper-2)',
            color: syncing ? 'var(--ammoc-ink-400)' : 'var(--ammoc-ink-700)',
            border: '1.5px solid var(--ammoc-line)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 14px', fontSize: 13, fontWeight: 600,
            cursor: syncing ? 'default' : 'pointer',
            transition: 'all 0.15s',
          }}
        >
          <span style={{
            display: 'inline-block',
            animation: syncing ? 'spin 0.8s linear infinite' : 'none',
          }}>🔄</span>
          {syncing ? 'Sincronizando...' : 'Sincronizar'}
        </button>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Buscar por contato ou município..."
        value={searchTerm}
        onChange={e => setSearchTerm(e.target.value)}
        style={{
          width: '100%', border: '1.5px solid var(--ammoc-line)',
          borderRadius: 'var(--radius-sm)', padding: '9px 12px',
          fontSize: 14, outline: 'none', marginBottom: 16,
          background: 'var(--ammoc-paper)', color: 'var(--ammoc-ink-900)',
          boxSizing: 'border-box',
        }}
      />

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: statusFilter === tab.key ? 'var(--ammoc-green)' : 'var(--ammoc-paper-2)',
              color: statusFilter === tab.key ? 'white' : 'var(--ammoc-ink-600)',
              border: 'none', borderRadius: 'var(--radius-sm)',
              padding: '6px 14px', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {tab.label}
            <span style={{
              background: statusFilter === tab.key ? 'rgba(255,255,255,0.25)' : 'var(--ammoc-line-2)',
              color: statusFilter === tab.key ? 'white' : 'var(--ammoc-ink-400)',
              fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 99,
            }}>
              {counts[tab.key]}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <div style={{
            width: 32, height: 32, border: '3px solid var(--ammoc-line-2)',
            borderTopColor: 'var(--ammoc-green)', borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          background: 'var(--ammoc-paper)', border: '1.5px dashed var(--ammoc-line)',
          borderRadius: 'var(--radius)', padding: '48px 32px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>💬</div>
          <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 14 }}>
            Nenhuma conversa encontrada
          </div>
        </div>
      ) : (
        <div>
          {filtered.map(conv => (
            <div
              key={conv.id}
              onClick={() => router.push(`/conversa/${conv.id}`)}
              style={{
                background: 'var(--ammoc-paper)',
                border: '1px solid var(--ammoc-line-2)',
                borderRadius: 'var(--radius)',
                padding: 16,
                marginBottom: 8,
                boxShadow: 'var(--shadow-card)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                cursor: 'pointer',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--ammoc-green)';
                (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.1)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--ammoc-line-2)';
                (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-card)';
              }}
            >
              {/* Icon */}
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: 'var(--ammoc-green-100)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, flexShrink: 0,
              }}>
                💬
              </div>

              {/* Main info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{
                    fontWeight: 700, fontSize: 14,
                    color: 'var(--ammoc-ink-900)', whiteSpace: 'nowrap',
                  }}>
                    {conv.contact_name || conv.contact_number}
                  </span>
                  {conv.municipality && (
                    <span style={{
                      background: 'var(--ammoc-paper-3)', color: 'var(--ammoc-ink-600)',
                      fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 99,
                    }}>
                      {conv.municipality}
                    </span>
                  )}
                  <StatusBadge status={conv.status} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                    {conv.contact_number}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>·</span>
                  <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                    {fmtTime(conv.last_message_at)}
                  </span>
                </div>
              </div>

              {/* Accept button */}
              {conv.status === 'pendente' && (
                <button
                  onClick={e => { e.stopPropagation(); void handleAccept(conv); }}
                  disabled={acceptingId === conv.id}
                  style={{
                    background: acceptingId === conv.id ? 'var(--ammoc-line)' : 'var(--ammoc-green)',
                    color: 'white', border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 14px', fontSize: 13, fontWeight: 600,
                    cursor: acceptingId === conv.id ? 'default' : 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {acceptingId === conv.id ? 'Aceitando...' : 'Aceitar'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
