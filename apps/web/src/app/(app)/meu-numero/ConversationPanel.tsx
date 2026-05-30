'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

function mediaTypeFromMime(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

interface Message {
  id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  content: string;
  message_type: string;
  media_url: string | null;
  sent_at: string;
}

interface Props {
  conversationId: string;
  contactName: string;
  contactNumber: string;
  avatarUrl: string | null;
  token: string | null;
  onBack?: () => void;
}

export function ConversationPanel({ conversationId, contactName, contactNumber, avatarUrl, token, onBack }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const loadMessages = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('id, conversation_id, direction, content, message_type, media_url, sent_at')
      .eq('conversation_id', conversationId)
      .order('sent_at', { ascending: true });
    setMessages((data ?? []) as Message[]);
    setLoading(false);
  }, [supabase, conversationId]);

  useEffect(() => {
    setLoading(true);
    void loadMessages();
    const iv = setInterval(() => { void loadMessages(); }, 5000);
    return () => clearInterval(iv);
  }, [loadMessages]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function handleSendText() {
    if (!token || !text.trim() || sending) return;
    setSending(true); setError(null);
    const body = text.trim();
    setText('');
    try {
      const res = await fetch(`${API}/api/whatsapp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversationId, text: body }),
      });
      if (!res.ok) throw new Error(await res.text());
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
      const path = `${uid}/${conversationId}/${Date.now()}-${safe}`;
      const up = await supabase.storage.from('wa-media').upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw new Error(up.error.message);
      const { data: pub } = supabase.storage.from('wa-media').getPublicUrl(path);
      const mediaUrl = pub.publicUrl;
      const mediaType = mediaTypeFromMime(file.type);
      const res = await fetch(`${API}/api/whatsapp/send-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversationId, mediaUrl, mediaType, fileName: file.name, caption: text.trim() || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      setText('');
      await loadMessages();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar mídia');
    }
    setUploading(false);
  }

  const initials = contactName.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const fmtTime = (ts: string) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--ammoc-line-2)', background: 'var(--ammoc-paper-2)' }}>
        {onBack && (
          <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ammoc-ink-600)', padding: 0, marginRight: 2 }}>←</button>
        )}
        <div style={{ width: 38, height: 38, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'var(--ammoc-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 14 }}>
          {avatarUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={avatarUrl} alt={contactName} style={{ width: 38, height: 38, objectFit: 'cover' }} />
            : (initials || '?')}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ammoc-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contactName}</div>
          <div style={{ fontSize: 11, color: 'var(--ammoc-ink-400)' }}>{contactNumber}</div>
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--ammoc-surface, #f7f5f0)' }}>
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
                <a href={m.media_url} target="_blank" rel="noreferrer" style={{ display: 'block', marginBottom: 4, color: 'var(--ammoc-green-700)', fontSize: 13, fontWeight: 600 }}>📎 {m.content}</a>
              )}
              {(m.message_type === 'text' || (!m.media_url && m.content)) && (
                <div style={{ fontSize: 13, color: 'var(--ammoc-ink-900)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</div>
              )}
              <div style={{ fontSize: 10, color: 'var(--ammoc-ink-400)', textAlign: 'right', marginTop: 2 }}>{fmtTime(m.sent_at)}</div>
            </div>
          );
        })}
      </div>

      {error && <div style={{ padding: '6px 16px', fontSize: 12, color: '#b91c1c', background: '#fef2f2' }}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '10px 12px', borderTop: '1px solid var(--ammoc-line-2)', background: 'var(--ammoc-paper-2)' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*,application/pdf,application/*"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ''; }}
        />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Anexar mídia" style={{ background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 16, cursor: uploading ? 'default' : 'pointer', flexShrink: 0 }}>
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
        <button type="button" onClick={() => void handleSendText()} disabled={sending || !text.trim()} style={{ background: 'var(--ammoc-green)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: sending || !text.trim() ? 'default' : 'pointer', opacity: !text.trim() ? 0.5 : 1, flexShrink: 0 }}>
          {sending ? '…' : 'Enviar'}
        </button>
      </div>
    </div>
  );
}
