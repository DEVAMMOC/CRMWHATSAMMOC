import type { SupabaseClient } from '@supabase/supabase-js';

/** Item de conversa do Canal normalizado para as listas do "Meu Painel". */
export interface PanelCanalItem {
  channel: 'canal';
  id: string;
  name: string;
  number: string;
  status: string;
  sector_id: string | null;
  municipality: string | null;
  subject: string | null;
  assigned_to: string | null;
  last_message_at: string | null;
  numberLabel: string | null;
}

/**
 * Busca conversas do Canal (RLS escopa por assigned_to/leads_sector/admin) já
 * normalizadas para mesclar com as conversas do número pessoal nas telas do painel.
 * `opts.status` e `opts.assignedTo` aplicam filtros adicionais quando informados.
 */
export async function fetchCanalItems(
  supabase: SupabaseClient,
  opts: { status?: string; assignedTo?: string } = {},
): Promise<PanelCanalItem[]> {
  let q = supabase
    .from('canal_conversations')
    .select(
      'id, wa_contact_name, wa_contact_number, status, sector_id, municipality, subject, assigned_to, last_message_at, canal_numbers(label)',
    )
    .order('last_message_at', { ascending: false });
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.assignedTo) q = q.eq('assigned_to', opts.assignedTo);
  const { data } = await q;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    channel: 'canal' as const,
    id: r.id as string,
    name: (r.wa_contact_name as string | null) || (r.wa_contact_number as string),
    number: r.wa_contact_number as string,
    status: r.status as string,
    sector_id: (r.sector_id as string | null) ?? null,
    municipality: (r.municipality as string | null) ?? null,
    subject: (r.subject as string | null) ?? null,
    assigned_to: (r.assigned_to as string | null) ?? null,
    last_message_at: (r.last_message_at as string | null) ?? null,
    numberLabel: (r.canal_numbers as { label?: string } | null)?.label ?? null,
  }));
}
