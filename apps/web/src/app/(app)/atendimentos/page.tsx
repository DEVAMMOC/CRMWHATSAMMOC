'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useIsMobile } from '@/lib/use-is-mobile';
import { fetchCanalItems, type PanelCanalItem } from '@/lib/canal-list';
import { getApiBase } from '@/lib/api-base';

interface Conversation {
  id: string;
  contact_number: string;
  contact_name: string | null;
  municipality: string | null;
  status: string;
}

interface AssignedUser {
  id: string;
  name: string;
  email: string;
}

interface Attendance {
  id: string;
  conversation_id: string;
  assigned_to: string;
  status: 'aberto' | 'em_andamento' | 'transferido' | 'encerrado';
  municipality: string | null;
  summary: string | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  conversation: Conversation | null;
  assigned_user: AssignedUser | null;
}

interface AppUser {
  id: string;
  name: string;
  email: string;
}

type AttendanceStatusFilter = 'all' | 'aberto' | 'em_andamento' | 'encerrado';

interface TransferModalState {
  open: boolean;
  attendanceId: string;
  attendanceConvId: string;
}

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

export default function AtendimentosPage() {
  const isMobile = useIsMobile();
  const router = useRouter();
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [canalItems, setCanalItems] = useState<PanelCanalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<AttendanceStatusFilter>('all');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [closingCanalId, setClosingCanalId] = useState<string | null>(null);

  // Transfer modal state
  const [transferModal, setTransferModal] = useState<TransferModalState | null>(null);
  const [allUsers, setAllUsers] = useState<AppUser[]>([]);
  const [transferToUserId, setTransferToUserId] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);

  const supabase = createClient();

  const loadAttendances = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('attendances')
      .select(`*, conversation:conversations(*), assigned_user:users!assigned_to(id, name, email)`)
      .order('opened_at', { ascending: false });

    if (error) {
      console.error('Error loading attendances:', error);
    } else {
      setAttendances((data as Attendance[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
        try {
          const items = await fetchCanalItems(supabase, { status: 'human', assignedTo: user.id });
          setCanalItems(items);
        } catch (err) {
          console.error('Error loading canal items:', err);
        }
      }
      await loadAttendances();
    })();
  }, [loadAttendances]);

  const handleCloseCanal = async (item: PanelCanalItem) => {
    const confirmed = window.confirm(
      `Encerrar atendimento do Canal de ${item.name || item.number || 'este contato'}?`
    );
    if (!confirmed) return;

    setClosingCanalId(item.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${getApiBase()}/api/canal/conversations/${item.id}/close`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
      }
      setCanalItems(prev => prev.filter(c => c.id !== item.id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert('Erro ao encerrar atendimento do Canal: ' + msg);
    } finally {
      setClosingCanalId(null);
    }
  };

  const handleClose = async (attendance: Attendance) => {
    const confirmed = window.confirm(
      `Encerrar atendimento de ${attendance.conversation?.contact_name || attendance.conversation?.contact_number || 'este contato'}?`
    );
    if (!confirmed) return;

    setClosingId(attendance.id);
    try {
      const now = new Date().toISOString();
      if (attendance.conversation_id) {
        // Encerra via API: marca encerrada, fecha o atendimento e exporta SÓ o
        // trecho compartilhada→encerrada p/ o Segundo Cérebro.
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${getApiBase()}/api/conversations/${attendance.conversation_id}/close`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({ message: res.statusText }));
          throw new Error(b.message ?? 'Erro ao encerrar');
        }
      } else {
        const { error: attError } = await supabase
          .from('attendances')
          .update({ status: 'encerrado', closed_at: now })
          .eq('id', attendance.id);
        if (attError) throw attError;
      }

      setAttendances(prev =>
        prev.map(a => a.id === attendance.id ? { ...a, status: 'encerrado', closed_at: now } : a)
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert('Erro ao encerrar atendimento: ' + msg);
    } finally {
      setClosingId(null);
    }
  };

  const openTransferModal = async (attendance: Attendance) => {
    // Load users if not already loaded
    if (allUsers.length === 0) {
      const { data } = await supabase.from('users').select('id, name, email');
      if (data) setAllUsers(data as AppUser[]);
    }
    setTransferToUserId('');
    setTransferNote('');
    setTransferModal({
      open: true,
      attendanceId: attendance.id,
      attendanceConvId: attendance.conversation_id,
    });
  };

  const handleTransfer = async () => {
    if (!transferModal || !transferToUserId || !currentUserId) return;
    setTransferring(true);
    try {
      // Insert transfer record
      const { error: transferError } = await supabase.from('attendance_transfers').insert({
        attendance_id: transferModal.attendanceId,
        from_user_id: currentUserId,
        to_user_id: transferToUserId,
        note: transferNote || null,
        transferred_at: new Date().toISOString(),
      });
      if (transferError) throw transferError;

      // Update attendance assigned_to and status
      const { error: updateError } = await supabase
        .from('attendances')
        .update({ assigned_to: transferToUserId, status: 'transferido' })
        .eq('id', transferModal.attendanceId);
      if (updateError) throw updateError;

      const newUser = allUsers.find(u => u.id === transferToUserId) ?? null;
      setAttendances(prev =>
        prev.map(a =>
          a.id === transferModal.attendanceId
            ? { ...a, assigned_to: transferToUserId, status: 'transferido', assigned_user: newUser }
            : a
        )
      );
      setTransferModal(null);
      alert('Atendimento transferido com sucesso!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert('Erro ao transferir: ' + msg);
    } finally {
      setTransferring(false);
    }
  };

  const filtered = attendances.filter(a => {
    if (statusFilter === 'all') return true;
    return a.status === statusFilter;
  });

  // Conversas do Canal em atendimento ('human') aparecem nas abas Todos e Em andamento.
  const showCanal = statusFilter === 'all' || statusFilter === 'em_andamento';
  const filteredCanal = showCanal ? canalItems : [];

  const counts: Record<AttendanceStatusFilter, number> = {
    all: attendances.length + canalItems.length,
    aberto: attendances.filter(a => a.status === 'aberto').length,
    em_andamento: attendances.filter(a => a.status === 'em_andamento').length + canalItems.length,
    encerrado: attendances.filter(a => a.status === 'encerrado').length,
  };

  const tabs: { key: AttendanceStatusFilter; label: string }[] = [
    { key: 'all',         label: 'Todos' },
    { key: 'aberto',      label: 'Abertos' },
    { key: 'em_andamento',label: 'Em andamento' },
    { key: 'encerrado',   label: 'Encerrados' },
  ];

  return (
    <div style={{ padding: isMobile ? 16 : 32, flex: 1, minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800,
          color: 'var(--ammoc-ink-900)', margin: 0, letterSpacing: '-0.02em',
        }}>
          Atendimentos
        </h1>
        <span style={{
          background: 'var(--ammoc-paper-3)', color: 'var(--ammoc-ink-600)',
          fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 99,
        }}>
          {attendances.length + canalItems.length}
        </span>
      </div>

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
      ) : filtered.length === 0 && filteredCanal.length === 0 ? (
        <div style={{
          background: 'var(--ammoc-paper)', border: '1.5px dashed var(--ammoc-line)',
          borderRadius: 'var(--radius)', padding: '48px 32px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
          <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 14 }}>
            Nenhum atendimento encontrado
          </div>
        </div>
      ) : (
        <div>
          {/* Atendimentos ativos do Canal atribuídos a mim */}
          {filteredCanal.map(item => (
            <div
              key={`canal-${item.id}`}
              onClick={() => router.push('/canal')}
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
              {/* Icon */}
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: 'var(--ammoc-green-100)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20, flexShrink: 0,
              }}>
                📡
              </div>

              {/* Main info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ammoc-ink-900)' }}>
                    {item.name || item.number || '—'}
                  </span>
                  <span style={{
                    background: 'var(--color-blue-bg)', color: 'var(--color-blue)',
                    fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 99,
                  }}>
                    📡 Canal{item.numberLabel ? ` · ${item.numberLabel}` : ''}
                  </span>
                  <span style={{
                    background: 'var(--color-yellow-bg)', color: 'var(--color-yellow)',
                    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap',
                  }}>
                    Em atendimento
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {item.municipality && (
                    <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                      📍 {item.municipality}
                    </span>
                  )}
                  {item.municipality && item.subject && (
                    <span style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>·</span>
                  )}
                  {item.subject && (
                    <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                      🏷️ {item.subject}
                    </span>
                  )}
                  {(item.municipality || item.subject) && (
                    <span style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>·</span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                    Última msg: {fmtTime(item.last_message_at)}
                  </span>
                </div>
              </div>

              {/* Action: Encerrar (Canal) */}
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCloseCanal(item); }}
                  disabled={closingCanalId === item.id}
                  style={{
                    background: closingCanalId === item.id ? 'var(--ammoc-line)' : 'var(--ammoc-red)',
                    color: 'white', border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 14px', fontSize: 13, fontWeight: 600,
                    cursor: closingCanalId === item.id ? 'default' : 'pointer',
                  }}
                >
                  {closingCanalId === item.id ? 'Encerrando...' : 'Encerrar'}
                </button>
              </div>
            </div>
          ))}

          {filtered.map(att => {
            const contactLabel = att.conversation?.contact_name || att.conversation?.contact_number || '—';
            const municipality = att.municipality || att.conversation?.municipality || null;
            const isActive = att.status === 'aberto' || att.status === 'em_andamento';

            return (
              <div
                key={att.id}
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
                {/* Icon */}
                <div style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: isActive ? 'var(--ammoc-green-100)' : 'var(--ammoc-paper-3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, flexShrink: 0,
                }}>
                  📋
                </div>

                {/* Main info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ammoc-ink-900)' }}>
                      {contactLabel}
                    </span>
                    {municipality && (
                      <span style={{
                        background: 'var(--ammoc-paper-3)', color: 'var(--ammoc-ink-600)',
                        fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 99,
                      }}>
                        {municipality}
                      </span>
                    )}
                    <StatusBadge status={att.status} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                      Responsável: {att.assigned_user?.name ?? '—'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>·</span>
                    <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                      Aberto: {fmtTime(att.opened_at)}
                    </span>
                    {att.closed_at && (
                      <>
                        <span style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>·</span>
                        <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                          Encerrado: {fmtTime(att.closed_at)}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions — only for active attendances */}
                {isActive && (
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => openTransferModal(att)}
                      style={{
                        background: 'transparent',
                        border: '1.5px solid var(--ammoc-line)',
                        color: 'var(--ammoc-ink-600)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '6px 14px', fontSize: 13, fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Transferir
                    </button>
                    <button
                      onClick={() => handleClose(att)}
                      disabled={closingId === att.id}
                      style={{
                        background: closingId === att.id ? 'var(--ammoc-line)' : 'var(--ammoc-red)',
                        color: 'white', border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        padding: '6px 14px', fontSize: 13, fontWeight: 600,
                        cursor: closingId === att.id ? 'default' : 'pointer',
                      }}
                    >
                      {closingId === att.id ? 'Encerrando...' : 'Encerrar'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Transfer Modal */}
      {transferModal?.open && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={e => { if (e.target === e.currentTarget) setTransferModal(null); }}
        >
          <div style={{
            background: 'var(--ammoc-paper)',
            borderRadius: 'var(--radius-lg)',
            padding: 28,
            width: 420,
            maxWidth: '90vw',
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <h2 style={{
              fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800,
              color: 'var(--ammoc-ink-900)', margin: '0 0 20px 0', letterSpacing: '-0.02em',
            }}>
              Transferir Atendimento
            </h2>

            <div style={{ marginBottom: 16 }}>
              <label style={{
                display: 'block', fontSize: 13, fontWeight: 600,
                color: 'var(--ammoc-ink-600)', marginBottom: 6,
              }}>
                Transferir para
              </label>
              <select
                value={transferToUserId}
                onChange={e => setTransferToUserId(e.target.value)}
                style={{
                  width: '100%', border: '1.5px solid var(--ammoc-line)',
                  borderRadius: 'var(--radius-sm)', padding: '9px 12px',
                  fontSize: 14, outline: 'none', background: 'var(--ammoc-paper)',
                  color: 'var(--ammoc-ink-900)', boxSizing: 'border-box',
                  appearance: 'auto',
                }}
              >
                <option value="">Selecione um usuário...</option>
                {allUsers
                  .filter(u => u.id !== currentUserId)
                  .map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
              </select>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{
                display: 'block', fontSize: 13, fontWeight: 600,
                color: 'var(--ammoc-ink-600)', marginBottom: 6,
              }}>
                Nota (opcional)
              </label>
              <textarea
                value={transferNote}
                onChange={e => setTransferNote(e.target.value)}
                placeholder="Descreva o motivo da transferência..."
                rows={3}
                style={{
                  width: '100%', border: '1.5px solid var(--ammoc-line)',
                  borderRadius: 'var(--radius-sm)', padding: '9px 12px',
                  fontSize: 14, outline: 'none', resize: 'vertical',
                  background: 'var(--ammoc-paper)', color: 'var(--ammoc-ink-900)',
                  fontFamily: 'var(--font-body)', boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setTransferModal(null)}
                disabled={transferring}
                style={{
                  background: 'transparent', border: '1.5px solid var(--ammoc-line)',
                  color: 'var(--ammoc-ink-600)', borderRadius: 'var(--radius-sm)',
                  padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleTransfer}
                disabled={!transferToUserId || transferring}
                style={{
                  background: !transferToUserId || transferring ? 'var(--ammoc-line)' : 'var(--ammoc-green)',
                  color: 'white', border: 'none', borderRadius: 'var(--radius-sm)',
                  padding: '8px 18px', fontSize: 13, fontWeight: 600,
                  cursor: !transferToUserId || transferring ? 'default' : 'pointer',
                }}
              >
                {transferring ? 'Transferindo...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
