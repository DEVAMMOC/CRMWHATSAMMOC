'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { AppUser, Conversation } from '@crmwhats/types';
import Image from 'next/image';

// ── helpers ──────────────────────────────────────────────────────────────────

function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
}

async function apiFetch(path: string, token: string, opts: RequestInit = {}) {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(txt);
  }
  return res.json();
}

// ── styles ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)',
  borderRadius: 'var(--radius)', padding: '24px', marginBottom: 16,
};

const btn = (variant: 'primary' | 'ghost' | 'danger'): React.CSSProperties => ({
  background: variant === 'primary' ? 'var(--ammoc-green)' : variant === 'danger' ? 'var(--ammoc-red)' : 'var(--ammoc-paper-2)',
  color: variant === 'ghost' ? 'var(--ammoc-ink-600)' : 'white',
  border: variant === 'ghost' ? '1px solid var(--ammoc-line-2)' : 'none',
  borderRadius: 'var(--radius-sm)', padding: '8px 18px',
  fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-body)',
});

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '8px 20px', fontSize: 13, fontWeight: active ? 700 : 500,
  color: active ? 'var(--ammoc-green-700)' : 'var(--ammoc-ink-400)',
  borderBottom: active ? '2px solid var(--ammoc-green)' : '2px solid transparent',
  background: 'none', border: 'none', cursor: 'pointer',
  fontFamily: 'var(--font-body)',
});

// ── main component ────────────────────────────────────────────────────────────

export default function MeuNumeroPage() {
  // Fix 1: stable Supabase client reference — no re-creation on every render
  const supabase = useMemo(() => createClient(), []);

  const [user, setUser] = useState<AppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<'conexao' | 'conversas'>('conexao');
  const [loading, setLoading] = useState(true);

  // Connection tab state
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairPhone, setPairPhone] = useState('');
  const [showPair, setShowPair] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const qrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Conversations tab state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [convError, setConvError] = useState<string | null>(null);
  const [convSearch, setConvSearch] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // ── Load user + session ──────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? null;
      setToken(accessToken);

      const { data: authData } = await supabase.auth.getUser();
      const uid = authData.user?.id;
      if (!uid) { setLoading(false); return; }

      const { data } = await supabase.from('users').select('*').eq('id', uid).single();
      if (data) {
        setUser(data as AppUser);
        const dbStatus = (data as AppUser).whatsapp_status ?? 'disconnected';
        // Fix 2: if session token is missing, don't show non-disconnected status —
        // the user can't issue API calls anyway.
        setWsStatus(accessToken ? dbStatus : 'disconnected');
      }
      setLoading(false);
    }
    load();
  }, [supabase]);

  // ── QR polling ────────────────────────────────────────────────────────────────
  const startQrPoll = useCallback((tok: string) => {
    if (qrPollRef.current) clearInterval(qrPollRef.current);
    qrPollRef.current = setInterval(async () => {
      try {
        const data = await apiFetch('/api/whatsapp/qr', tok);
        if (data.base64) setQrBase64(data.base64);
      } catch {
        // QR not ready yet — keep polling
      }

      // Check status
      try {
        const st = await apiFetch('/api/whatsapp/status', tok);
        if (st.status === 'connected' || st.status === 'open') {
          setWsStatus('connected');
          setQrBase64(null);
          if (qrPollRef.current) clearInterval(qrPollRef.current);
        }
      } catch { /* ignore */ }
    }, 3000);
  }, []);

  // Auto-start status polling if page is loaded while in connecting state
  // (e.g. user reloaded after scanning QR). Also drives real-time status
  // sync via the API's getStatus → Evolution Go check.
  useEffect(() => {
    if (wsStatus === 'connecting' && token) {
      startQrPoll(token);
    }
    return () => { if (qrPollRef.current) clearInterval(qrPollRef.current); };
  }, [wsStatus, token, startQrPoll]);

  // ── Actions ───────────────────────────────────────────────────────────────────
  async function handleConnect() {
    if (!token) return;
    setActionLoading(true);
    setConnError(null);
    setQrBase64(null);
    try {
      await apiFetch('/api/whatsapp/connect', token, { method: 'POST', body: '{}' });
      setWsStatus('connecting');
      startQrPoll(token);
    } catch (e: unknown) {
      setConnError(e instanceof Error ? e.message : 'Erro ao conectar');
    }
    setActionLoading(false);
  }

  async function handleDisconnect() {
    if (!token) return;
    setActionLoading(true);
    setConnError(null);
    try {
      await apiFetch('/api/whatsapp/disconnect', token, { method: 'DELETE' });
      setWsStatus('disconnected');
      setQrBase64(null);
      setPairCode(null);
      if (qrPollRef.current) clearInterval(qrPollRef.current);
    } catch (e: unknown) {
      setConnError(e instanceof Error ? e.message : 'Erro ao desconectar');
    }
    setActionLoading(false);
  }

  async function handlePair() {
    if (!token || !pairPhone.trim()) return;
    setActionLoading(true);
    setConnError(null);
    try {
      const phone = pairPhone.replace(/\D/g, '');
      const data = await apiFetch('/api/whatsapp/pair', token, {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      setPairCode(data.code ?? 'Código não disponível');
    } catch (e: unknown) {
      setConnError(e instanceof Error ? e.message : 'Erro ao obter código');
    }
    setActionLoading(false);
  }

  // ── Load conversations ────────────────────────────────────────────────────────
  useEffect(() => {
    if (tab !== 'conversas' || !user) return;
    async function load() {
      setConvError(null);
      setConvLoading(true); // Fix 3: signal loading
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('owner_user_id', user!.id)
        .order('last_message_at', { ascending: false, nullsFirst: false });
      if (error) setConvError(error.message);
      else setConversations((data ?? []) as Conversation[]);
      setConvLoading(false);
    }
    load();
  }, [tab, user, supabase]);

  async function handleShare(convId: string) {
    if (!token) return;
    setSharingId(convId);
    setConvError(null);
    try {
      await apiFetch(`/api/conversations/${convId}/share`, token, { method: 'POST', body: '{}' });
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, status: 'pendente' as const } : c));
    } catch (e: unknown) {
      setConvError(e instanceof Error ? e.message : 'Erro ao compartilhar');
    }
    setSharingId(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loading) return <div style={{ padding: 32, color: 'var(--ammoc-ink-400)', fontSize: 14 }}>Carregando...</div>;

  const statusColor = wsStatus === 'connected'
    ? 'var(--ammoc-green)' : wsStatus === 'connecting'
    ? '#F59E0B' : 'var(--ammoc-ink-400)';
  const statusLabel = wsStatus === 'connected' ? 'Conectado' : wsStatus === 'connecting' ? 'Conectando…' : 'Desconectado';

  return (
    <div style={{ padding: '32px', flex: 1, maxWidth: 800 }}>
      {/* Header */}
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--ammoc-ink-900)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
        Meu Número WhatsApp
      </h1>
      <p style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, margin: '0 0 20px' }}>
        Conecte seu número e gerencie conversas.
      </p>

      {/* Tabs — Fix 4: type="button" on all non-submit buttons */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--ammoc-line)', marginBottom: 20 }}>
        <button type="button" style={tabBtn(tab === 'conexao')} onClick={() => setTab('conexao')}>Conexão</button>
        <button type="button" style={tabBtn(tab === 'conversas')} onClick={() => setTab('conversas')}>Minhas Conversas</button>
      </div>

      {/* ── TAB: CONEXÃO ──────────────────────────────────────────────────────── */}
      {tab === 'conexao' && (
        <>
          {/* Status card */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div aria-hidden="true" style={{ width: 12, height: 12, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ammoc-ink-900)' }}>{statusLabel}</div>
                  {user?.whatsapp_number && (
                    <div style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>{user.whatsapp_number}</div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {wsStatus === 'disconnected' && (
                  <button type="button" style={btn('primary')} onClick={handleConnect} disabled={actionLoading}>
                    {actionLoading ? 'Conectando…' : 'Conectar WhatsApp'}
                  </button>
                )}
                {wsStatus !== 'disconnected' && (
                  <button type="button" style={btn('danger')} onClick={handleDisconnect} disabled={actionLoading}>
                    Desconectar
                  </button>
                )}
              </div>
            </div>
          </div>

          {connError && (
            <div style={{ background: 'var(--ammoc-red-100)', border: '1px solid var(--ammoc-red)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 13, color: 'var(--ammoc-red-700)', marginBottom: 16 }}>
              {connError}
            </div>
          )}

          {/* QR Code */}
          {wsStatus === 'connecting' && (
            <div style={{ ...card, textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ammoc-ink-900)', marginBottom: 8 }}>
                Escaneie o QR code
              </div>
              <p style={{ fontSize: 12, color: 'var(--ammoc-ink-400)', marginBottom: 16 }}>
                Abra o WhatsApp no celular → Aparelhos conectados → Conectar aparelho
              </p>
              {qrBase64 ? (
                <Image
                  src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                  alt="QR Code WhatsApp"
                  width={220}
                  height={220}
                  style={{ margin: '0 auto', display: 'block', borderRadius: 8 }}
                  unoptimized
                />
              ) : (
                <div style={{ width: 220, height: 220, background: 'var(--ammoc-surface)', borderRadius: 8, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ammoc-ink-400)', fontSize: 13 }}>
                  Aguardando QR…
                </div>
              )}

              {/* Pairing code alternative */}
              <div style={{ marginTop: 20 }}>
                <button type="button" style={{ ...btn('ghost'), fontSize: 12 }} onClick={() => setShowPair(p => !p)}>
                  {showPair ? 'Ocultar' : 'Usar código de pareamento'}
                </button>
              </div>

              {showPair && (
                <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {/* Fix 4: aria-label on phone input */}
                  <input
                    type="tel"
                    aria-label="Número de telefone para pareamento"
                    placeholder="55479999999999"
                    value={pairPhone}
                    onChange={e => setPairPhone(e.target.value)}
                    style={{ border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 13, fontFamily: 'var(--font-body)', background: 'var(--ammoc-paper)', color: 'var(--ammoc-ink)', outline: 'none', width: 200 }}
                  />
                  <button type="button" style={btn('primary')} onClick={handlePair} disabled={actionLoading || !pairPhone.trim()}>
                    Obter código
                  </button>
                </div>
              )}

              {pairCode && (
                <div style={{ marginTop: 12, background: 'var(--ammoc-green-100)', border: '1px solid var(--ammoc-green)', borderRadius: 'var(--radius-sm)', padding: '12px 20px', display: 'inline-block' }}>
                  <div style={{ fontSize: 11, color: 'var(--ammoc-ink-400)', marginBottom: 4 }}>Código de pareamento</div>
                  <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '0.2em', color: 'var(--ammoc-green-800)', fontFamily: 'var(--font-mono)' }}>{pairCode}</div>
                  <div style={{ fontSize: 11, color: 'var(--ammoc-ink-400)', marginTop: 4 }}>Digite este código no WhatsApp → Aparelhos conectados</div>
                </div>
              )}
            </div>
          )}

          {wsStatus === 'connected' && (
            <div style={{ ...card, background: 'var(--ammoc-green-100)', border: '1px solid var(--ammoc-green)' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ammoc-green-800)' }}>
                ✅ WhatsApp conectado com sucesso!
              </div>
              <p style={{ fontSize: 13, color: 'var(--ammoc-green-700)', margin: '6px 0 0' }}>
                As mensagens recebidas aparecerão na aba &quot;Minhas Conversas&quot;.
              </p>
            </div>
          )}
        </>
      )}

      {/* ── TAB: CONVERSAS ────────────────────────────────────────────────────── */}
      {tab === 'conversas' && (
        <div style={{ background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>

          {/* WhatsApp-style header with search */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--ammoc-line-2)', background: 'var(--ammoc-paper-2)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ammoc-ink-900)', marginBottom: 10 }}>
              Minhas conversas
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, background: 'var(--ammoc-line-2)', color: 'var(--ammoc-ink-400)', padding: '2px 8px', borderRadius: 99 }}>
                {conversations.length}
              </span>
            </div>
            <input
              type="text"
              placeholder="🔍  Pesquisar conversa..."
              value={convSearch}
              onChange={e => setConvSearch(e.target.value)}
              style={{ width: '100%', background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '7px 12px', fontSize: 13, outline: 'none', color: 'var(--ammoc-ink-900)', boxSizing: 'border-box' }}
            />
          </div>

          {convError && (
            <div style={{ padding: '10px 16px', fontSize: 13, color: '#b91c1c', background: '#fef2f2', borderBottom: '1px solid #fca5a5' }}>
              {convError}
            </div>
          )}

          {/* Conversation list */}
          {convLoading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ammoc-ink-400)', fontSize: 13 }}>
              <div style={{ width: 24, height: 24, border: '3px solid var(--ammoc-line-2)', borderTopColor: 'var(--ammoc-green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
              Carregando conversas…
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : conversations.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--ammoc-ink-400)' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Nenhuma conversa ainda</div>
              <div style={{ fontSize: 12 }}>Conecte seu WhatsApp na aba Conexão e aguarde mensagens chegarem.</div>
            </div>
          ) : (() => {
            const filtered = conversations.filter(c => {
              const q = convSearch.toLowerCase();
              return !q || (c.contact_name ?? '').toLowerCase().includes(q) || c.contact_number.includes(q);
            });
            return filtered.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--ammoc-ink-400)', fontSize: 13 }}>
                Nenhuma conversa encontrada para &quot;{convSearch}&quot;
              </div>
            ) : (
              <div>
                {filtered.map(conv => {
                  const name = conv.contact_name || conv.contact_number;
                  const initials = name.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
                  const avatarColors = ['#25D366','#128C7E','#075E54','#34B7F1','#00BFA5','#1565C0','#6A1B9A','#AD1457','#E65100','#558B2F'];
                  const colorIdx = name.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0) % avatarColors.length;
                  const avatarColor = avatarColors[colorIdx];
                  const isShared = conv.status !== 'nao_salva';
                  const isHovered = hoveredId === conv.id;

                  const fmtTime = (ts: string | null) => {
                    if (!ts) return '';
                    const d = new Date(ts);
                    const now = new Date();
                    const diffMs = now.getTime() - d.getTime();
                    const diffMin = Math.floor(diffMs / 60000);
                    if (diffMin < 1) return 'agora';
                    if (diffMin < 60) return `${diffMin}min`;
                    const diffH = Math.floor(diffMin / 60);
                    if (diffH < 24) return `${diffH}h`;
                    if (diffH < 24 * 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
                    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                  };

                  const statusBadge: Record<string, { label: string; color: string; bg: string }> = {
                    pendente:  { label: 'Pendente',  color: '#92400e', bg: '#fef3c7' },
                    ativa:     { label: 'Ativa',     color: '#14532d', bg: '#dcfce7' },
                    encerrada: { label: 'Encerrada', color: '#6b7280', bg: '#f3f4f6' },
                  };
                  const badge = isShared ? (statusBadge[conv.status] ?? statusBadge['pendente']) : null;

                  return (
                    <div
                      key={conv.id}
                      onMouseEnter={() => setHoveredId(conv.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                        borderBottom: '1px solid var(--ammoc-line-2)',
                        background: isHovered ? 'var(--ammoc-paper-2)' : 'transparent',
                        transition: 'background 0.1s', cursor: 'default', position: 'relative',
                      }}
                    >
                      {/* Avatar */}
                      <div style={{ width: 46, height: 46, borderRadius: '50%', background: avatarColor, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' }}>
                        {initials || '?'}
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ammoc-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {name}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--ammoc-ink-400)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                            {fmtTime(conv.last_message_at)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, color: 'var(--ammoc-ink-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {conv.contact_number}
                          </span>
                          {badge && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: badge.bg, color: badge.color, flexShrink: 0 }}>
                              {badge.label}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Share button — always visible on mobile, revealed on hover on desktop */}
                      <div style={{ flexShrink: 0, opacity: isShared ? 1 : (isHovered ? 1 : 0.4), transition: 'opacity 0.15s' }}>
                        {isShared ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--ammoc-green-700)' }}>
                            <span style={{ fontSize: 15 }}>✓</span>
                            <span style={{ display: isHovered ? 'inline' : 'none' }}>Compartilhada</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={sharingId === conv.id}
                            onClick={() => void handleShare(conv.id)}
                            title="Compartilhar com a organização"
                            style={{
                              display: 'flex', alignItems: 'center', gap: 5,
                              background: isHovered ? 'var(--ammoc-green)' : 'var(--ammoc-green-100)',
                              color: isHovered ? 'white' : 'var(--ammoc-green-700)',
                              border: 'none', borderRadius: 'var(--radius-sm)',
                              padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                              transition: 'all 0.15s',
                              opacity: sharingId === conv.id ? 0.6 : 1,
                            }}
                          >
                            {sharingId === conv.id ? (
                              '…'
                            ) : (
                              <>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                                Compartilhar
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
