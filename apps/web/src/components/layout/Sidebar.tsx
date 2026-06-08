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
  badgeTone?: 'red' | 'green';
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
      {item.badge != null && (
        <span
          className={styles.navBadge}
          style={item.badgeTone === 'green' ? { background: 'var(--ammoc-green)' } : undefined}
        >
          {item.badge}
        </span>
      )}
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
  const [recebidos, setRecebidos] = useState(0);       // não atendidas (Aguardando/Pendente)
  const [atendimentos, setAtendimentos] = useState(0); // em atendimento

  // Poll badges para esta sessão (15s + ao montar). Todas as contagens são
  // RLS-scoped — batem com o que cada papel vê nas próprias telas.
  useEffect(() => {
    const supabase = createClient();
    const headCount = (q: { count: number | null }) => q.count ?? 0;
    const load = async () => {
      const [unread, convPend, canalOpen, attActive, canalHuman] = await Promise.all([
        supabase.from('internal_messages').select('id', { count: 'exact', head: true })
          .eq('recipient_id', user.id).is('read_at', null),
        // Recebidos = conversas pessoais pendentes + Canal "Aguardando" (open).
        supabase.from('conversations').select('id', { count: 'exact', head: true })
          .eq('status', 'pendente'),
        supabase.from('canal_conversations').select('id', { count: 'exact', head: true })
          .eq('status', 'open'),
        // Atendimentos = atendimentos pessoais não encerrados + Canal "Em atendimento" (human).
        supabase.from('attendances').select('id', { count: 'exact', head: true })
          .neq('status', 'encerrado'),
        supabase.from('canal_conversations').select('id', { count: 'exact', head: true })
          .eq('status', 'human'),
      ]);
      setInternalUnread(headCount(unread));
      setRecebidos(headCount(convPend) + headCount(canalOpen));
      setAtendimentos(headCount(attActive) + headCount(canalHuman));
    };
    void load();
    const iv = setInterval(() => { void load(); }, 15000);
    return () => clearInterval(iv);
  }, [user.id]);

  // Injeta os badges ao vivo nos itens do "Meu painel".
  const funcionarioNav: NavItem[] = FUNCIONARIO_NAV.map(item => {
    if (item.href === '/recebidos' && recebidos > 0) return { ...item, badge: recebidos, badgeTone: 'red' as const };
    if (item.href === '/atendimentos' && atendimentos > 0) return { ...item, badge: atendimentos, badgeTone: 'green' as const };
    return item;
  });

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
        {funcionarioNav.map(item => <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />)}

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
