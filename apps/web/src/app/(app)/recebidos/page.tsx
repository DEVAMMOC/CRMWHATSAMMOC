'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useIsMobile } from '@/lib/use-is-mobile';
import { fetchCanalItems, type PanelCanalItem } from '@/lib/canal-list';
import { getApiBase } from '@/lib/api-base';

interface Conversation {
  id: string;
  owner_user_id: string;
  contact_number: string;
  contact_name: string | null;
  status: string;
  source: 'pessoal' | 'bot';
  municipality: string | null;
  trigger_keywords: string[] | null;
  last_message_at: string | null;
  last_synced_at: string | null;
  created_at: string;
}

interface OwnerUser {
  id: string;
  name: string;
  email: string;
}

interface ConversationWithOwner extends Conversation {
  owner?: OwnerUser | null;
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

export default function RecebidosPage() {
  const isMobile = useIsMobile();
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationWithOwner[]>([]);
  const [canalItems, setCanalItems] = useState<PanelCanalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [assumingId, setAssumingId] = useState<string | null>(null);

  const supabase = createClient();

  const loadData = useCallback(async () => {
    setLoading(true);
    // Conversas pessoais compartilhadas/ativas (RLS filtra por papel — owner/lead/admin).
    const { data: convData, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('status', 'pendente')
      .order('last_message_at', { ascending: false });

    if (convError) {
      console.error('Error loading conversations:', convError);
      setLoading(false);
      return;
    }

    const convs = (convData as Conversation[]) ?? [];

    // Fetch owner user names for each unique owner
    const ownerIds = [...new Set(convs.map(c => c.owner_user_id).filter(Boolean))];
    let ownerMap: Record<string, OwnerUser> = {};

    if (ownerIds.length > 0) {
      const { data: usersData } = await supabase
        .from('users')
        .select('id, name, email')
        .in('id', ownerIds);
      if (usersData) {
        ownerMap = Object.fromEntries((usersData as OwnerUser[]).map(u => [u.id, u]));
      }
    }

    const enriched: ConversationWithOwner[] = convs.map(c => ({
      ...c,
      owner: ownerMap[c.owner_user_id] ?? null,
    }));

    setConversations(enriched);

    // Conversas do Canal "Aguardando" (status 'open'). Sem filtro de assigned_to:
    // a RLS já escopa — funcionário vê as atribuídas a ele; o CHEFE DE SETOR vê as
    // do seu setor (delegadas ao setor, mesmo sem dono); admin/supervisor veem todas.
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const items = await fetchCanalItems(supabase, { status: 'open' });
      setCanalItems(items);
    } else {
      setCanalItems([]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
      }
      await loadData();
    })();
  }, [loadData]);

  const handleAssume = async (conv: ConversationWithOwner) => {
    if (!currentUserId) return;
    setAssumingId(conv.id);
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

      setConversations(prev => prev.filter(c => c.id !== conv.id));
      alert('Atendimento assumido com sucesso!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert('Erro ao assumir atendimento: ' + msg);
    } finally {
      setAssumingId(null);
    }
  };

  const handleAssumeCanal = async (item: PanelCanalItem) => {
    setAssumingId(item.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${getApiBase()}/api/canal/conversations/${item.id}/assume`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      });
      if (!res.ok) throw new Error(await res.text());

      setCanalItems(prev => prev.filter(c => c.id !== item.id));
      router.push('/canal');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert('Erro ao assumir conversa do Canal: ' + msg);
    } finally {
      setAssumingId(null);
    }
  };

  const totalReceived = conversations.length + canalItems.length;

  return (
    <div style={{ padding: isMobile ? 16 : 32, flex: 1, minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800,
          color: 'var(--ammoc-ink-900)', margin: 0, letterSpacing: '-0.02em',
        }}>
          Recebidos
        </h1>
        <span style={{
          background: 'var(--color-yellow-bg)', color: 'var(--color-yellow)',
          fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 99,
        }}>
          {totalReceived} pendente{totalReceived !== 1 ? 's' : ''}
        </span>
      </div>

      <p style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, margin: '0 0 20px 0' }}>
        Conversas aguardando atendimento. Assuma para iniciar o suporte.
      </p>

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
      ) : totalReceived === 0 ? (
        <div style={{
          background: 'var(--ammoc-paper)', border: '1.5px dashed var(--ammoc-line)',
          borderRadius: 'var(--radius)', padding: '56px 32px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ammoc-ink-900)', marginBottom: 6 }}>
            Tudo em dia!
          </div>
          <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 14 }}>
            Nenhuma conversa pendente
          </div>
        </div>
      ) : (
        <div>
          {conversations.map(conv => (
            <div
              key={conv.id}
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
              }}
            >
              {/* Avatar */}
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: 'var(--color-yellow-bg)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20, flexShrink: 0,
              }}>
                📥
              </div>

              {/* Main info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{
                    fontWeight: 700, fontSize: 14,
                    color: 'var(--ammoc-ink-900)',
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
                  <span style={{
                    background: 'var(--color-yellow-bg)', color: 'var(--color-yellow)',
                    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                  }}>
                    Pendente
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                    {conv.contact_number}
                  </span>
                  {conv.owner && (
                    <>
                      <span style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>·</span>
                      <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                        Responsável: {conv.owner.name}
                      </span>
                    </>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>·</span>
                  <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                    {fmtTime(conv.created_at)}
                  </span>
                </div>
              </div>

              {/* Assume button */}
              <button
                onClick={() => handleAssume(conv)}
                disabled={assumingId === conv.id}
                style={{
                  background: assumingId === conv.id ? 'var(--ammoc-line)' : 'var(--ammoc-green)',
                  color: 'white', border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '7px 16px', fontSize: 13, fontWeight: 600,
                  cursor: assumingId === conv.id ? 'default' : 'pointer',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                {assumingId === conv.id ? 'Assumindo...' : 'Assumir atendimento'}
              </button>
            </div>
          ))}

          {/* Canal conversations delegated to me and awaiting */}
          {canalItems.map(item => (
            <div
              key={item.id}
              onClick={() => router.push('/canal')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') router.push('/canal'); }}
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
              }}
            >
              {/* Avatar */}
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: 'var(--color-yellow-bg)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20, flexShrink: 0,
              }}>
                📡
              </div>

              {/* Main info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{
                    fontWeight: 700, fontSize: 14,
                    color: 'var(--ammoc-ink-900)',
                  }}>
                    {item.name}
                  </span>
                  <span style={{
                    background: 'var(--ammoc-paper-3)', color: 'var(--ammoc-ink-600)',
                    fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 99,
                  }}>
                    📡 Canal
                  </span>
                  {item.numberLabel && (
                    <span style={{
                      background: 'var(--ammoc-paper-3)', color: 'var(--ammoc-ink-600)',
                      fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 99,
                    }}>
                      {item.numberLabel}
                    </span>
                  )}
                  <span style={{
                    background: 'var(--color-yellow-bg)', color: 'var(--color-yellow)',
                    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                  }}>
                    Aguardando
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                    {item.number}
                  </span>
                  {item.municipality && (
                    <>
                      <span style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>·</span>
                      <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                        📍 {item.municipality}
                      </span>
                    </>
                  )}
                  {item.subject && (
                    <>
                      <span style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>·</span>
                      <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                        🏷️ {item.subject}
                      </span>
                    </>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>·</span>
                  <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                    {fmtTime(item.last_message_at)}
                  </span>
                </div>
              </div>

              {/* Assume button */}
              <button
                onClick={(e) => { e.stopPropagation(); handleAssumeCanal(item); }}
                disabled={assumingId === item.id}
                style={{
                  background: assumingId === item.id ? 'var(--ammoc-line)' : 'var(--ammoc-green)',
                  color: 'white', border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '7px 16px', fontSize: 13, fontWeight: 600,
                  cursor: assumingId === item.id ? 'default' : 'pointer',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                {assumingId === item.id ? 'Assumindo...' : '✋ Assumir'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
