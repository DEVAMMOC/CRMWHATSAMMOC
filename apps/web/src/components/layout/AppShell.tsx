// apps/web/src/components/layout/AppShell.tsx
import AppShellClient from './AppShellClient';
import type { AppUser } from '@crmwhats/types';

export default function AppShell({ user, children }: { user: AppUser; children: React.ReactNode }) {
  return <AppShellClient user={user}>{children}</AppShellClient>;
}
