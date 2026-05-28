// apps/web/src/components/layout/Sidebar.tsx
'use client';

import Link from 'next/link';
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
  { icon: '💬', label: 'Conversas', href: '/dashboard' },
  { icon: '📋', label: 'Atendimentos', href: '/atendimentos' },
  { icon: '📥', label: 'Recebidos', href: '/recebidos' },
];

const WHATSAPP_NAV: NavItem[] = [
  { icon: '📱', label: 'Meu número', href: '/meu-numero', dot: true },
  { icon: '🔔', label: 'Notificações', href: '/notificacoes' },
];

const ORG_NAV: NavItem[] = [
  { icon: '🏛️', label: 'Base AMMOC', href: '/base' },
  { icon: '👥', label: 'Equipe', href: '/equipe' },
];

const ADMIN_NAV: NavItem[] = [
  { icon: '📊', label: 'Painel Admin', href: '/admin' },
  { icon: '⚙️', label: 'Configurações', href: '/configuracoes' },
];

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

// Hoisted outside Sidebar to avoid React remounting on every render
function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'));
  return (
    <Link
      href={item.href}
      className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
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
}

export default function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
    router.push('/login');
  }

  return (
    <nav className={styles.sidebar}>
      <div className={styles.brand}>
        <div className={styles.logoMark}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect x="2" y="2" width="16" height="16" rx="4" fill="var(--ammoc-green-800)"/>
            <path d="M6 10h8M10 6v8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
        <div>
          <div className={styles.brandName}>AMMOC</div>
          <div className={styles.brandSub}>CRMWhats</div>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.navSection}>Meu painel</div>
        {FUNCIONARIO_NAV.map(item => <NavLink key={item.href} item={item} pathname={pathname} />)}

        <div className={styles.navSection}>WhatsApp</div>
        {WHATSAPP_NAV.map(item => <NavLink key={item.href} item={item} pathname={pathname} />)}

        <div className={styles.navSection}>Organização</div>
        {ORG_NAV.map(item => <NavLink key={item.href} item={item} pathname={pathname} />)}

        {(user.role === 'supervisor' || user.role === 'admin') && (
          <>
            <div className={styles.navSection}>Admin</div>
            {ADMIN_NAV.map(item => <NavLink key={item.href} item={item} pathname={pathname} />)}
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
