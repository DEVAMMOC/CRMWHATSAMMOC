'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getApiBase } from '@/lib/api-base';
import { useIsMobile } from '@/lib/use-is-mobile';
import type { CanalNumber } from '@crmwhats/types';

const API = getApiBase();

const WEBHOOK_URL = 'https://crm.ammoc.org.br/api/canal/webhook';

interface CanalConfig {
  wabaId: string;
  accessToken: string;
  verifyToken: string;
  appSecret: string;
  numbers: CanalNumber[];
}

async function apiFetch(path: string, token: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  if (!res.ok) throw new Error(await res.text());
  // Some endpoints (PUT/DELETE) may return empty body
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

const card: React.CSSProperties = {
  background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)',
  borderRadius: 'var(--radius)', padding: 24, marginBottom: 16,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--ammoc-ink-600)', display: 'block', marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%', border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)',
  padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  background: 'var(--ammoc-paper)', color: 'var(--ammoc-ink-900)',
};

export default function CanalConfigPage() {
  const supabase = createClient();
  const isMobile = useIsMobile();
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);

  // Connection form — keep the masked values separately to know if the user typed a new secret.
  const [wabaId, setWabaId] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [maskedAccessToken, setMaskedAccessToken] = useState('');
  const [maskedAppSecret, setMaskedAppSecret] = useState('');

  const [numbers, setNumbers] = useState<CanalNumber[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add-number form
  const [newPhoneNumberId, setNewPhoneNumberId] = useState('');
  const [newDisplayNumber, setNewDisplayNumber] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [addingNumber, setAddingNumber] = useState(false);

  // Test-connection results per number id
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; error?: string }>>({});

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    try {
      const cfg = await apiFetch('/api/canal/config', tok) as CanalConfig;
      setWabaId(cfg.wabaId ?? '');
      setVerifyToken(cfg.verifyToken ?? '');
      setMaskedAccessToken(cfg.accessToken ?? '');
      setMaskedAppSecret(cfg.appSecret ?? '');
      setAccessToken('');
      setAppSecret('');
      setNumbers(cfg.numbers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar configuração');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token ?? '';
      setToken(tok);
      await load(tok);
    })();
  }, [load, supabase]);

  async function handleSave() {
    setSaving(true); setError(null); setSavedMsg(null);
    try {
      const body: Record<string, string> = { wabaId, verifyToken };
      // Only send a secret if the user typed a new (non-masked) value.
      if (accessToken.trim()) body.accessToken = accessToken.trim();
      if (appSecret.trim()) body.appSecret = appSecret.trim();
      await apiFetch('/api/canal/config', token, { method: 'PUT', body: JSON.stringify(body) });
      setSavedMsg('Configuração salva.');
      await load(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    }
    setSaving(false);
  }

  async function handleAddNumber() {
    if (!newPhoneNumberId.trim() || !newDisplayNumber.trim()) return;
    setAddingNumber(true); setError(null);
    try {
      await apiFetch('/api/canal/numbers', token, {
        method: 'POST',
        body: JSON.stringify({
          phoneNumberId: newPhoneNumberId.trim(),
          displayNumber: newDisplayNumber.trim(),
          label: newLabel.trim() || undefined,
        }),
      });
      setNewPhoneNumberId(''); setNewDisplayNumber(''); setNewLabel('');
      await load(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao adicionar número');
    }
    setAddingNumber(false);
  }

  async function handleRemoveNumber(id: string) {
    if (!confirm('Remover este número? As conversas vinculadas a ele serão removidas.')) return;
    setError(null);
    try {
      await apiFetch(`/api/canal/numbers/${id}`, token, { method: 'DELETE' });
      await load(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao remover número');
    }
  }

  async function handleTest(phoneNumberId: string, id: string) {
    setTesting(prev => ({ ...prev, [id]: true }));
    setTestResult(prev => ({ ...prev, [id]: undefined as unknown as { ok: boolean } }));
    try {
      const result = await apiFetch('/api/canal/test-connection', token, {
        method: 'POST',
        body: JSON.stringify({ phoneNumberId }),
      }) as { ok: boolean; error?: string };
      setTestResult(prev => ({ ...prev, [id]: result }));
    } catch (e) {
      setTestResult(prev => ({ ...prev, [id]: { ok: false, error: e instanceof Error ? e.message : 'Erro' } }));
    }
    setTesting(prev => ({ ...prev, [id]: false }));
  }

  return (
    <div style={{ padding: isMobile ? 16 : 32, flex: 1, maxWidth: isMobile ? '100%' : 800 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--ammoc-ink-900)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
        Canal AMMOC — Configuração
      </h1>
      <p style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, margin: '0 0 20px' }}>
        Credenciais da Meta WhatsApp Cloud API e números dedicados.
      </p>

      {error && (
        <div style={{ background: 'var(--ammoc-red-100, #fef2f2)', border: '1px solid #fca5a5', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--ammoc-ink-400)' }}>Carregando…</p>
      ) : (
        <>
          {/* ── Conexão Meta (WABA) ─────────────────────────────────────────────── */}
          <div style={card}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ammoc-ink-900)', margin: '0 0 16px' }}>Conexão Meta (WABA)</h2>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>WABA ID</label>
              <input value={wabaId} onChange={e => setWabaId(e.target.value)} placeholder="123456789012345" style={inputStyle} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Access Token</label>
              <input
                type="password"
                value={accessToken}
                onChange={e => setAccessToken(e.target.value)}
                placeholder={maskedAccessToken || 'Cole o token permanente'}
                style={inputStyle}
              />
              {maskedAccessToken && !accessToken && (
                <div style={{ fontSize: 11, color: 'var(--ammoc-ink-400)', marginTop: 4 }}>Token salvo: {maskedAccessToken}. Deixe em branco para manter.</div>
              )}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Verify Token</label>
              <input value={verifyToken} onChange={e => setVerifyToken(e.target.value)} placeholder="token de verificação do webhook" style={inputStyle} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>App Secret</label>
              <input
                type="password"
                value={appSecret}
                onChange={e => setAppSecret(e.target.value)}
                placeholder={maskedAppSecret || 'App Secret do app Meta'}
                style={inputStyle}
              />
              {maskedAppSecret && !appSecret && (
                <div style={{ fontSize: 11, color: 'var(--ammoc-ink-400)', marginTop: 4 }}>Secret salvo: {maskedAppSecret}. Deixe em branco para manter.</div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={() => void handleSave()} disabled={saving}
                style={{ background: 'var(--ammoc-green)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
              {savedMsg && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ammoc-green-700)' }}>✓ {savedMsg}</span>}
            </div>
          </div>

          {/* ── Números dedicados ───────────────────────────────────────────────── */}
          <div style={card}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ammoc-ink-900)', margin: '0 0 16px' }}>Números dedicados</h2>

            {numbers.length === 0 ? (
              <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, marginBottom: 16, fontStyle: 'italic' }}>Nenhum número cadastrado ainda.</div>
            ) : (
              <div style={{ marginBottom: 16 }}>
                {numbers.map(n => {
                  const res = testResult[n.id];
                  return (
                    <div key={n.id} style={{ border: '1px solid var(--ammoc-line-2)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ammoc-ink-900)' }}>
                            {n.label || n.display_number}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>{n.display_number}</div>
                          <div style={{ fontSize: 11, color: 'var(--ammoc-ink-300)', fontFamily: 'var(--font-mono)' }}>ID: {n.phone_number_id}</div>
                        </div>
                        <button onClick={() => void handleTest(n.phone_number_id, n.id)} disabled={testing[n.id]}
                          style={{ background: 'var(--ammoc-paper-2)', border: '1px solid var(--ammoc-line)', color: 'var(--ammoc-ink-700)', borderRadius: 'var(--radius-sm)', padding: '5px 12px', fontSize: 12, cursor: testing[n.id] ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                          {testing[n.id] ? 'Testando…' : 'Testar conexão'}
                        </button>
                        <button onClick={() => void handleRemoveNumber(n.id)}
                          style={{ background: 'none', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 'var(--radius-sm)', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>
                          Remover
                        </button>
                      </div>
                      {res && (
                        <div style={{ fontSize: 12, marginTop: 8, fontWeight: 600, color: res.ok ? 'var(--ammoc-green-700)' : '#b91c1c' }}>
                          {res.ok ? '✓ Conexão OK' : `✗ ${res.error ?? 'Falha na conexão'}`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--ammoc-line-2)', paddingTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ammoc-ink-700)', marginBottom: 10 }}>Adicionar número</div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                <div>
                  <label style={labelStyle}>Phone Number ID</label>
                  <input value={newPhoneNumberId} onChange={e => setNewPhoneNumberId(e.target.value)} placeholder="1098..." style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Número exibido</label>
                  <input value={newDisplayNumber} onChange={e => setNewDisplayNumber(e.target.value)} placeholder="+55 49 ..." style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Rótulo</label>
                  <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Ouvidoria" style={inputStyle} />
                </div>
                <button onClick={() => void handleAddNumber()} disabled={addingNumber || !newPhoneNumberId.trim() || !newDisplayNumber.trim()}
                  style={{ background: 'var(--ammoc-green)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: addingNumber ? 'default' : 'pointer', opacity: (!newPhoneNumberId.trim() || !newDisplayNumber.trim()) ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                  {addingNumber ? '…' : 'Adicionar'}
                </button>
              </div>
            </div>
          </div>

          {/* ── Como configurar na Meta ─────────────────────────────────────────── */}
          <div style={card}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ammoc-ink-900)', margin: '0 0 12px' }}>Como configurar na Meta</h2>
            <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--ammoc-ink-700)', fontSize: 13, lineHeight: 1.8 }}>
              <li>
                No app da Meta (Meta for Developers → WhatsApp → Configuration), cadastre a URL do webhook de callback:
                <div style={{ marginTop: 4, background: 'var(--ammoc-paper-2)', border: '1px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ammoc-ink-900)', wordBreak: 'break-all' }}>
                  {WEBHOOK_URL}
                </div>
              </li>
              <li style={{ marginTop: 6 }}>
                Use o <strong>Verify Token</strong> salvo acima no campo &quot;Verify token&quot; da Meta.
              </li>
              <li style={{ marginTop: 6 }}>
                Inscreva-se (Subscribe) no evento <strong>messages</strong>.
              </li>
            </ol>
          </div>
        </>
      )}
    </div>
  );
}
