// apps/web/src/components/layout/AppShell.tsx
import Sidebar from './Sidebar';
import type { AppUser } from '@crmwhats/types';
import styles from './AppShell.module.css';

interface AppShellProps {
  user: AppUser;
  children: React.ReactNode;
}

export default function AppShell({ user, children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <Sidebar user={user} />
      <div className={styles.main}>
        {children}
      </div>
    </div>
  );
}
