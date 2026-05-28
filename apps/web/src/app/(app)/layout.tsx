// apps/web/src/app/(app)/layout.tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AppShell from '@/components/layout/AppShell';
import type { AppUser } from '@crmwhats/types';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();

  if (!authUser) redirect('/login');

  const { data: appUser } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .single();

  if (!appUser) redirect('/login');

  return <AppShell user={appUser as AppUser}>{children}</AppShell>;
}
