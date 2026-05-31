'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useIsMobile } from '@/lib/use-is-mobile';
import type { AppUser } from '@crmwhats/types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ConvRow { id: string; status: string; last_message_at: string | null }

interface AttendanceRow {
  id: string;
  status: string;
  opened_at: string;
  municipality: string | null;
  conversation: { contact_name: string; contact_number: string } | null;
  user: { name: string } | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtRelative(ts: string) {
  const d = new Date(ts);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function roleBadge(role: string) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    admin:      { bg: '#FCEBE8', color: '#C0392B', label: 'Admin' },
    supervisor: { bg: '#EFF6FF', color: '#1D4ED8', label: 'Supervisor' },
    funcionario:{ bg: '#E6F0E5', color: '#166331', label: 'Funcionário' },
  };
  const s = map[role] ?? map.funcionario;
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700,
      padding: '2px 8px', borderRadius: 99, letterSpacing: '0.02em' }}>
      {s.label}
    </span>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({ icon, value, label }: { icon: string; value: number | string; label: string }) {
  return (
    <div style={{ background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)',
      borderRadius: 'var(--radius)', padding: '20px 24px', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 28, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 32, fontWeight: 800, fontFamily: 'var(--font-display)',
        color: 'var(--ammoc-ink-900)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 13, color: 'var(--ammoc-ink-400)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const supabase = createClient();
  const isMobile = useIsMobile();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [recentAtt, setRecentAtt] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [usersRes, convsRes, attOpenRes, attRecentRes] = await Promise.all([
          supabase.from('users').select('id, name, role, is_online, created_at, email, whatsapp_number, evolution_instance_id, evolution_instance_token'),
          supabase.from('conversations').select('id, status, last_message_at').order('last_message_at', { ascending: false }).limit(20),
          supabase.from('attendances').select('id, status, opened_at, municipality, assigned_to').eq('status', 'aberto').limit(50),
          supabase.from('attendances').select('id, status, municipality, opened_at, conversation:conversations(contact_name, contact_number), user:users!assigned_to(name)').order('opened_at', { ascending: false }).limit(5),
        ]);

        if (usersRes.error) throw usersRes.error;
        if (convsRes.error) throw convsRes.error;
        if (attOpenRes.error) throw attOpenRes.error;
        if (attRecentRes.error) throw attRecentRes.error;

        setUsers((usersRes.data ?? []) as AppUser[]);
        setConvs((convsRes.data ?? []) as ConvRow[]);
        setOpenCount((attOpenRes.data ?? []).length);
        setRecentAtt((attRecentRes.data ?? []) as unknown as AttendanceRow[]);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar dados.');
      } finally {
        setLoading(false);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onlineCount = users.filter(u => u.is_online).length;
  const activeConvs = convs.filter(c => c.status === 'ativa').length;

  return (
    <div style={{ padding: isMobile ? 16 : '32px', flex: 1 }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800,
          color: 'var(--ammoc-ink-900)', margin: 0, letterSpacing: '-0.02em' }}>
          Painel Admin
        </h1>
        <p style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, margin: '4px 0 0' }}>
          Visão geral do sistema — atualizado ao entrar na página.
        </p>
      </div>

      {error && (
        <div style={{ background: '#FCEBE8', color: '#C0392B', padding: '10px 14px',
          borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 20 }}>
          {error}
        </div>
      )}

      {/* KPI Row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <KpiCard icon="👥" value={loading ? '…' : users.length} label="Total de usuários" />
        <KpiCard icon="🟢" value={loading ? '…' : onlineCount} label="Online agora" />
        <KpiCard icon="💬" value={loading ? '…' : activeConvs} label="Conversas ativas" />
        <KpiCard icon="📋" value={loading ? '…' : openCount} label="Atendimentos abertos" />
      </div>

      {/* Two-col grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Recent Attendances */}
        <div style={{ background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)',
          borderRadius: 'var(--radius)', padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ammoc-ink-900)', marginBottom: 12 }}>
            Últimos Atendimentos
          </div>
          {loading ? (
            <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 13 }}>Carregando…</div>
          ) : recentAtt.length === 0 ? (
            <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 13 }}>Nenhum atendimento recente.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recentAtt.map(att => (
                <div key={att.id} style={{ padding: '10px 12px', background: 'var(--ammoc-paper-2)',
                  borderRadius: 'var(--radius-sm)', border: '1px solid var(--ammoc-line-2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ammoc-ink-900)' }}>
                        {att.conversation?.contact_name ?? att.conversation?.contact_number ?? '—'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ammoc-ink-400)', marginTop: 2 }}>
                        {att.municipality ?? 'Sem município'}
                        {att.user?.name ? ` · ${att.user.name}` : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ammoc-ink-400)', whiteSpace: 'nowrap', marginLeft: 8 }}>
                      {fmtRelative(att.opened_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Team Status */}
        <div style={{ background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)',
          borderRadius: 'var(--radius)', padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ammoc-ink-900)', marginBottom: 12 }}>
            Status da Equipe
          </div>
          {loading ? (
            <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 13 }}>Carregando…</div>
          ) : users.length === 0 ? (
            <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 13 }}>Nenhum usuário encontrado.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {users.map(u => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                  background: 'var(--ammoc-paper-2)', border: '1px solid var(--ammoc-line-2)' }}>
                  <span style={{
                    width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                    background: u.is_online ? 'var(--status-online)' : 'var(--ammoc-line)',
                    border: u.is_online ? '1.5px solid #16a34a' : '1.5px solid #b8b4ae',
                  }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--ammoc-ink-900)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {u.name}
                  </span>
                  {roleBadge(u.role)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
