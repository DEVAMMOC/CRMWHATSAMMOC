'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import type { AppUser } from '@crmwhats/types';
import styles from './AppShell.module.css';

export default function AppShellClient({ user, children }: { user: AppUser; children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => { setDrawerOpen(false); }, [pathname]);
  useEffect(() => {
    if (drawerOpen) document.body.style.overflow = 'hidden'; else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <button type="button" className={styles.hamburger} aria-label="Abrir menu" onClick={() => setDrawerOpen(true)}>☰</button>
        <span className={styles.topbarBrand}>AMMOC <span className={styles.topbarSub}>CRMWhats</span></span>
      </header>
      {drawerOpen && <div className={styles.overlay} onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
      <div className={`${styles.sidebarWrap} ${drawerOpen ? styles.sidebarWrapOpen : ''}`}>
        <Sidebar user={user} onNavigate={() => setDrawerOpen(false)} />
      </div>
      <div className={styles.main}>{children}</div>
    </div>
  );
}
