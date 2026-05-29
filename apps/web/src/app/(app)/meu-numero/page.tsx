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
  const [convLoading, setConvLoading] = useState(false); // Fix 3: loading state for conversations tab
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [convError, setConvError] = useState<string | null>(null);

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

  useEffect(() => () => { if (qrPollRef.current) clearInterval(qrPollRef.current); }, []);

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
        .in('status', ['nao_salva', 'pendente'])
        .order('last_message_at', { ascending: false });
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
    <div style={{ padding: '32px', flex: 1, maxWidth: 700 }}>
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
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ammoc-ink-900)', marginBottom: 4 }}>
            Conversas recebidas no seu WhatsApp
          </div>
          <p style={{ fontSize: 12, color: 'var(--ammoc-ink-400)', margin: '0 0 16px' }}>
            Selecione as conversas que deseja compartilhar com a organização.
          </p>

          {convError && (
            <div style={{ background: 'var(--ammoc-red-100)', border: '1px solid var(--ammoc-red)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 13, color: 'var(--ammoc-red-700)', marginBottom: 16 }}>
              {convError}
            </div>
          )}

          {/* Fix 3: show loading indicator while fetching */}
          {convLoading ? (
            <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
              Carregando conversas…
            </div>
          ) : conversations.length === 0 ? (
            <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
              Nenhuma conversa ainda. Conecte seu WhatsApp e aguarde mensagens.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {conversations.map(conv => (
                <div
                  key={conv.id}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--ammoc-line)' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ammoc-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {conv.contact_name || conv.contact_number}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                      {conv.contact_number}
                      {conv.last_message_at && ` · ${new Date(conv.last_message_at).toLocaleDateString('pt-BR')}`}
                    </div>
                  </div>
                  {conv.status === 'nao_salva' ? (
                    <button
                      type="button"
                      style={btn('primary')}
                      onClick={() => handleShare(conv.id)}
                      disabled={sharingId === conv.id}
                    >
                      {sharingId === conv.id ? 'Compartilhando…' : 'Compartilhar'}
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: 'var(--ammoc-green-100)', color: 'var(--ammoc-green-800)' }}>
                      Compartilhada
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
