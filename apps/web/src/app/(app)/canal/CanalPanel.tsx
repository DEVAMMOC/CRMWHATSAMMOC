'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getApiBase } from '@/lib/api-base';
import type { CanalMessage, CanalConversationStatus } from '@crmwhats/types';

const API = getApiBase();

function mediaTypeFromMime(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

interface Sector { id: string; name: string; color?: string }
interface OrgUser { id: string; name: string }

interface Props {
  conversationId: string;
  contactName: string;
  contactNumber: string;
  numberLabel: string;
  status: CanalConversationStatus | string;
  token: string | null;
  onBack?: () => void;
  onChanged?: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Aguardando',
  human: 'Em atendimento',
  closed: 'Encerrada',
};

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  open: { bg: '#fef3c7', color: '#92400e' },
  human: { bg: 'var(--ammoc-green-100)', color: 'var(--ammoc-green-800)' },
  closed: { bg: 'var(--ammoc-paper-3)', color: 'var(--ammoc-ink-400)' },
};

export function CanalPanel({ conversationId, contactName, contactNumber, numberLabel, status, token, onBack, onChanged }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<CanalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Delegation modal (mirrors conversa/[id])
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [showDelegate, setShowDelegate] = useState(false);
  const [delegateSectorId, setDelegateSectorId] = useState('');
  const [delegateUserId, setDelegateUserId] = useState('');
  const [delegating, setDelegating] = useState(false);
  const [closing, setClosing] = useState(false);

  const loadMessages = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/canal/conversations/${conversationId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as CanalMessage[];
      setMessages(data ?? []);
    } catch {
      // keep previous messages on transient error
    }
    setLoading(false);
  }, [conversationId, token]);

  useEffect(() => {
    setLoading(true);
    void loadMessages();
    const iv = setInterval(() => { void loadMessages(); }, 5000);
    return () => clearInterval(iv);
  }, [loadMessages]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Load sectors + users for the delegation modal (lazily on first open)
  useEffect(() => {
    if (!showDelegate || !token || sectors.length > 0) return;
    void (async () => {
      try {
        const [secRes, usrRes] = await Promise.all([
          fetch(`${API}/api/sectors`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API}/api/users`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (secRes.ok) setSectors(await secRes.json() as Sector[]);
        if (usrRes.ok) setOrgUsers(await usrRes.json() as OrgUser[]);
      } catch {
        // ignore — dropdowns just stay empty
      }
    })();
  }, [showDelegate, token, sectors.length]);

  async function handleSendText() {
    if (!token || !text.trim() || sending) return;
    setSending(true); setError(null);
    const body = text.trim();
    setText('');
    try {
      const res = await fetch(`${API}/api/canal/conversations/${conversationId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: body }),
      });
      if (!res.ok) {
        // Surface the API message (e.g. the 24h-window warning) but keep the field usable.
        const errBody = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(errBody.message ?? 'Erro ao enviar');
      }
      await loadMessages();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar');
      setText(body);
    }
    setSending(false);
  }

  async function handleFile(file: File) {
    if (!token) return;
    if (file.size > 26214400) { setError('Arquivo excede 25 MB'); return; }
    setUploading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error('Sessão expirada');
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `canal-out/${uid}/${conversationId}/${Date.now()}-${safe}`;
      const up = await supabase.storage.from('wa-media').upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw new Error(up.error.message);
      const { data: pub } = supabase.storage.from('wa-media').getPublicUrl(path);
      const res = await fetch(`${API}/api/canal/conversations/${conversationId}/send-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mediaUrl: pub.publicUrl, mediaType: mediaTypeFromMime(file.type), fileName: file.name, caption: text.trim() || undefined }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(errBody.message ?? 'Erro ao enviar mídia');
      }
      setText('');
      await loadMessages();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar mídia');
    }
    setUploading(false);
  }

  async function handleDelegate() {
    if (!token || (!delegateSectorId && !delegateUserId)) return;
    setDelegating(true); setError(null);
    try {
      const res = await fetch(`${API}/api/canal/conversations/${conversationId}/delegate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sectorId: delegateSectorId || undefined, assignedTo: delegateUserId || undefined }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(errBody.message ?? 'Erro ao delegar');
      }
      setShowDelegate(false);
      setDelegateSectorId(''); setDelegateUserId('');
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao delegar');
    }
    setDelegating(false);
  }

  async function handleClose() {
    if (!token || closing) return;
    if (!confirm('Encerrar esta conversa?')) return;
    setClosing(true); setError(null);
    try {
      const res = await fetch(`${API}/api/canal/conversations/${conversationId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(errBody.message ?? 'Erro ao encerrar');
      }
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao encerrar');
    }
    setClosing(false);
  }

  const initials = contactName.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const fmtTime = (ts: string) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const statusStyle = STATUS_STYLE[status] ?? STATUS_STYLE.open;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--ammoc-line-2)', background: 'var(--ammoc-paper-2)' }}>
        {onBack && (
          <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ammoc-ink-600)', padding: 0, marginRight: 2 }}>←</button>
        )}
        <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, background: 'var(--ammoc-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 14 }}>
          {initials || '?'}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ammoc-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contactName}</div>
          <div style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>{contactNumber}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {numberLabel && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--ammoc-paper-3)', color: 'var(--ammoc-ink-600)', whiteSpace: 'nowrap' }}>
              📡 {numberLabel}
            </span>
          )}
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: statusStyle.bg, color: statusStyle.color, whiteSpace: 'nowrap' }}>
            {STATUS_LABEL[status] ?? status}
          </span>
          <button type="button" onClick={() => setShowDelegate(true)}
            style={{ background: 'var(--ammoc-paper-2)', border: '1.5px solid var(--ammoc-line)', color: 'var(--ammoc-ink-700)', borderRadius: 'var(--radius-sm)', padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            🏛️ Delegar
          </button>
          <button type="button" onClick={() => void handleClose()} disabled={closing}
            style={{ background: 'none', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 'var(--radius-sm)', padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: closing ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
            {closing ? '…' : 'Encerrar'}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--ammoc-surface, #f7f5f0)' }}>
        {loading ? (
          <div style={{ margin: 'auto', color: 'var(--ammoc-ink-400)', fontSize: 13 }}>Carregando…</div>
        ) : messages.length === 0 ? (
          <div style={{ margin: 'auto', color: 'var(--ammoc-ink-400)', fontSize: 13, fontStyle: 'italic' }}>Sem mensagens ainda</div>
        ) : messages.map(m => {
          const out = m.direction === 'out';
          return (
            <div key={m.id} style={{ alignSelf: out ? 'flex-end' : 'flex-start', maxWidth: '72%', background: out ? 'var(--ammoc-green-100)' : 'white', border: '1px solid var(--ammoc-line-2)', borderRadius: 10, padding: '6px 10px' }}>
              {m.media_url && m.message_type === 'image' && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.media_url} alt={m.content} style={{ maxWidth: 240, borderRadius: 6, display: 'block', marginBottom: 4 }} />
              )}
              {m.media_url && m.message_type === 'video' && (
                <video src={m.media_url} controls style={{ maxWidth: 240, borderRadius: 6, display: 'block', marginBottom: 4 }} />
              )}
              {m.media_url && m.message_type === 'audio' && (
                <audio src={m.media_url} controls style={{ display: 'block', marginBottom: 4 }} />
              )}
              {m.media_url && m.message_type === 'document' && (
                <a href={m.media_url} target="_blank" rel="noreferrer" style={{ display: 'block', marginBottom: 4, color: 'var(--ammoc-green-700)', fontSize: 13, fontWeight: 600 }}>📎 {m.content || 'documento'}</a>
              )}
              {m.message_type !== 'text' && !m.media_url && (
                <div style={{ fontSize: 12, color: 'var(--ammoc-ink-400)', fontStyle: 'italic', marginBottom: 4 }}>⏳ baixando mídia…</div>
              )}
              {/* Legenda abaixo da mídia (imagem/vídeo/áudio). Documento já mostra o
                  nome no próprio link 📎 — excluído aqui p/ não duplicar. */}
              {(m.message_type === 'text' || (m.content && m.media_url && m.message_type !== 'document')) && (
                <div style={{ fontSize: 13, color: 'var(--ammoc-ink-900)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</div>
              )}
              <div style={{ fontSize: 10, color: 'var(--ammoc-ink-400)', textAlign: 'right', marginTop: 2 }}>{fmtTime(m.sent_at)}</div>
            </div>
          );
        })}
      </div>

      {error && (
        <div style={{ padding: '8px 16px', fontSize: 12, color: '#b91c1c', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: '#b91c1c', flexShrink: 0 }}>×</button>
        </div>
      )}

      {/* Composer */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '10px 12px', borderTop: '1px solid var(--ammoc-line-2)', background: 'var(--ammoc-paper-2)' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*,application/pdf,application/*"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ''; }}
        />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Anexar mídia"
          style={{ background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 16, cursor: uploading ? 'default' : 'pointer', flexShrink: 0 }}>
          {uploading ? '…' : '📎'}
        </button>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSendText(); } }}
          placeholder="Digite uma mensagem…"
          rows={1}
          style={{ flex: 1, resize: 'none', border: '1px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none', maxHeight: 120, color: 'var(--ammoc-ink-900)', background: 'var(--ammoc-paper)' }}
        />
        <button type="button" onClick={() => void handleSendText()} disabled={sending || !text.trim()}
          style={{ background: 'var(--ammoc-green)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: sending || !text.trim() ? 'default' : 'pointer', opacity: !text.trim() ? 0.5 : 1, flexShrink: 0 }}>
          {sending ? '…' : 'Enviar'}
        </button>
      </div>

      {/* Delegation modal */}
      {showDelegate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--ammoc-paper)', borderRadius: 'var(--radius)', padding: 28, width: 400, boxShadow: '0 8px 32px rgba(0,0,0,.2)' }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 800 }}>Delegar conversa</h2>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ammoc-ink-600)', display: 'block', marginBottom: 4 }}>Setor</label>
              <select value={delegateSectorId} onChange={e => setDelegateSectorId(e.target.value)}
                style={{ width: '100%', border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 13, boxSizing: 'border-box' }}>
                <option value="">Selecione um setor…</option>
                {sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ammoc-ink-600)', display: 'block', marginBottom: 4 }}>Funcionário (opcional)</label>
              <select value={delegateUserId} onChange={e => setDelegateUserId(e.target.value)}
                style={{ width: '100%', border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 13, boxSizing: 'border-box' }}>
                <option value="">Nenhum específico</option>
                {orgUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowDelegate(false)} style={{ background: 'var(--ammoc-paper-2)', border: '1px solid var(--ammoc-line)', color: 'var(--ammoc-ink-600)', borderRadius: 'var(--radius-sm)', padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
              <button type="button" onClick={() => void handleDelegate()} disabled={delegating || (!delegateSectorId && !delegateUserId)}
                style={{ background: 'var(--ammoc-green)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: delegating ? 'default' : 'pointer', opacity: (!delegateSectorId && !delegateUserId) ? 0.5 : 1 }}>
                {delegating ? 'Delegando…' : 'Confirmar delegação'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
