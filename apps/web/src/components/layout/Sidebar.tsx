// apps/web/src/components/layout/Sidebar.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { AppUser } from '@crmwhats/types';
import styles from './Sidebar.module.css';

interface NavItem {
  icon: string;
  label: string;
  href: string;
  badge?: number;
  dot?: boolean;
}

const FUNCIONARIO_NAV: NavItem[] = [
  { icon: '📥', label: 'Recebidos', href: '/recebidos' },
  { icon: '📋', label: 'Atendimentos', href: '/atendimentos' },
  { icon: '✅', label: 'Encerradas', href: '/dashboard' },
  { icon: '🗂️', label: 'Kanban', href: '/kanban' },
];

const WHATSAPP_NAV: NavItem[] = [
  { icon: '📱', label: 'Meu número', href: '/meu-numero', dot: true },
];

const ORG_NAV: NavItem[] = [
  { icon: '📇', label: 'Contatos', href: '/contatos' },
  { icon: '👥', label: 'Equipe', href: '/equipe' },
  { icon: '💬', label: 'Comunicação Interna', href: '/comunicacao-interna' },
];

const CANAL_NAV: NavItem[] = [
  { icon: '📡', label: 'Canal AMMOC', href: '/canal' },
  { icon: '⚙️', label: 'Canal — Config', href: '/canal/config' },
];

const ADMIN_NAV: NavItem[] = [
  { icon: '📊', label: 'Painel Admin', href: '/admin' },
  { icon: '🏛️', label: 'Setores', href: '/configuracoes/setores' },
  { icon: '⚙️', label: 'Configurações', href: '/configuracoes' },
];

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

// Hoisted outside Sidebar to avoid React remounting on every render
function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate?: () => void }) {
  const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'));
  return (
    <Link
      href={item.href}
      className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
      onClick={onNavigate}
    >
      <span className={styles.navIcon}>{item.icon}</span>
      {item.label}
      {item.badge != null && <span className={styles.navBadge}>{item.badge}</span>}
      {item.dot && <span className={styles.navDot} />}
    </Link>
  );
}

interface SidebarProps {
  user: AppUser;
  onNavigate?: () => void;
}

export default function Sidebar({ user, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [internalUnread, setInternalUnread] = useState(0);

  // Poll the unread internal-message count for this user (15s + on mount).
  useEffect(() => {
    const supabase = createClient();
    const loadUnread = async () => {
      const { count } = await supabase
        .from('internal_messages')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', user.id)
        .is('read_at', null);
      setInternalUnread(count ?? 0);
    };
    void loadUnread();
    const iv = setInterval(() => { void loadUnread(); }, 15000);
    return () => clearInterval(iv);
  }, [user.id]);

  // Inject the live badge into the Comunicação Interna item.
  const orgNav: NavItem[] = ORG_NAV.map(item =>
    item.href === '/comunicacao-interna' && internalUnread > 0
      ? { ...item, badge: internalUnread }
      : item,
  );

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
    router.push('/login');
  }

  return (
    <nav className={styles.sidebar}>
      <div className={styles.brand}>
        <Image
          src="/ammoc-logo.png"
          alt="AMMOC"
          width={40}
          height={40}
          className={styles.logoImg}
          priority
        />
        <div>
          <div className={styles.brandName}>AMMOC</div>
          <div className={styles.brandSub}>CRMWhats</div>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.navSection}>Meu painel</div>
        {FUNCIONARIO_NAV.map(item => <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />)}

        <div className={styles.navSection}>WhatsApp</div>
        {WHATSAPP_NAV.map(item => <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />)}

        <div className={styles.navSection}>Organização</div>
        {orgNav.map(item => <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />)}

        {(user.role === 'supervisor' || user.role === 'admin') && (
          <>
            <div className={styles.navSection}>Canal AMMOC</div>
            {CANAL_NAV.map(item => <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />)}

            <div className={styles.navSection}>Admin</div>
            {ADMIN_NAV.map(item => <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />)}
          </>
        )}
      </div>

      <div className={styles.footer}>
        <div className={styles.userRow}>
          <div className={styles.avatar}>{initials(user.name)}</div>
          <div>
            <div className={styles.userName}>{user.name}</div>
            <div className={styles.userRole}>{user.role}</div>
          </div>
          <div className={styles.statusDot} />
        </div>
        <button className={styles.logoutBtn} onClick={handleLogout}>
          Sair da conta
        </button>
      </div>
    </nav>
  );
}
