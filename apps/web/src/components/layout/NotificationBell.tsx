'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface Notif { id: string; title: string; body: string | null; link: string | null; read: boolean; created_at: string; }

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('notifications')
      .select('id, title, body, link, read, created_at')
      .order('created_at', { ascending: false })
      .limit(10);
    const list = (data ?? []) as Notif[];
    setItems(list);
    setUnread(list.filter(n => !n.read).length);
  }, []);

  useEffect(() => { void load(); const iv = setInterval(() => void load(), 20000); return () => clearInterval(iv); }, [load]);
  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function openItem(n: Notif) {
    const supabase = createClient();
    if (!n.read) { await supabase.from('notifications').update({ read: true }).eq('id', n.id); }
    setOpen(false);
    await load();
    if (n.link) router.push(n.link);
  }
  async function markAll() {
    const supabase = createClient();
    await supabase.from('notifications').update({ read: true }).eq('read', false);
    await load();
  }

  return (
    <div ref={ref} style={{ position: 'fixed', top: 12, right: 16, zIndex: 200 }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-label="Notificações"
        style={{ position: 'relative', width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--ammoc-line-2)', background: 'var(--ammoc-paper)', cursor: 'pointer', fontSize: 18, boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}>
        🔔
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#C0392B', color: 'white', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{unread}</span>
        )}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 48, right: 0, width: 320, maxHeight: 420, overflowY: 'auto', background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)', borderRadius: 'var(--radius)', boxShadow: '0 8px 28px rgba(0,0,0,.18)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--ammoc-line-2)' }}>
            <strong style={{ fontSize: 13 }}>Notificações</strong>
            <button type="button" onClick={() => void markAll()} style={{ background: 'none', border: 'none', color: 'var(--ammoc-green-700)', fontSize: 11, cursor: 'pointer' }}>marcar todas lidas</button>
          </div>
          {items.length === 0 ? (
            <div style={{ padding: 16, fontSize: 13, color: 'var(--ammoc-ink-400)', textAlign: 'center' }}>Sem notificações</div>
          ) : items.map(n => (
            <div key={n.id} onClick={() => void openItem(n)} style={{ padding: '10px 14px', borderBottom: '1px solid var(--ammoc-line-2)', cursor: 'pointer', background: n.read ? 'transparent' : 'var(--ammoc-green-100)' }}>
              <div style={{ fontSize: 13, fontWeight: n.read ? 500 : 700, color: 'var(--ammoc-ink-900)' }}>{n.title}</div>
              {n.body && <div style={{ fontSize: 12, color: 'var(--ammoc-ink-500)' }}>{n.body}</div>}
            </div>
          ))}
          <div onClick={() => { setOpen(false); router.push('/notificacoes'); }} style={{ padding: '10px 14px', textAlign: 'center', fontSize: 12, color: 'var(--ammoc-green-700)', cursor: 'pointer' }}>ver todas</div>
        </div>
      )}
    </div>
  );
}
