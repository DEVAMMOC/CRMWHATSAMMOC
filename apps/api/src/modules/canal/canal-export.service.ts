import { Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

const STATUS_MAP: Record<string, string> = {
  open: 'aberta',
  human: 'em_atendimento',
  closed: 'encerrada',
};

/** Slug seguro p/ caminho: sem acento, minúsculo, não-alfanumérico → hífen. */
export function slugify(s: string | null | undefined): string {
  return (
    (s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'sem'
  );
}

interface ConvRow {
  id: string;
  wa_contact_number: string;
  wa_contact_name: string | null;
  status: string;
  subject: string | null;
  municipality: string | null;
  assigned_to: string | null;
  assumed_by: string | null;
  closed_at: string | null;
  close_reason: string | null;
  last_message_at: string | null;
  created_at: string;
  sectors: { name: string } | null;
  canal_numbers: { label: string | null } | null;
}
interface MsgRow {
  direction: string;
  content: string | null;
  sent_at: string;
  is_system: boolean;
  sent_by: string | null;
}

/**
 * Compacta uma conversa do Canal num resumo .md + .json (contexto/resolução/
 * participantes/data/município/assunto) e grava em `context_files` como `pending`,
 * para o GithubSyncService enviar ao repositório do Segundo Cérebro.
 */
@Injectable()
export class CanalExportService {
  private readonly logger = new Logger(CanalExportService.name);
  constructor(private readonly supabase: SupabaseClient) {}

  async buildAndStore(canalConversationId: string): Promise<void> {
    const { data: convData } = await this.supabase
      .from('canal_conversations')
      .select('*, sectors(name), canal_numbers(label)')
      .eq('id', canalConversationId)
      .single();
    if (!convData) {
      this.logger.warn(`export: conversa ${canalConversationId} não encontrada`);
      return;
    }
    const c = convData as unknown as ConvRow;

    const { data: msgData } = await this.supabase
      .from('canal_messages')
      .select('direction, content, sent_at, is_system, sent_by')
      .eq('conversation_id', canalConversationId)
      .order('sent_at', { ascending: true });
    const messages = (msgData ?? []) as unknown as MsgRow[];

    // Resolve nomes/papéis dos participantes (atendentes).
    const userIds = new Set<string>();
    if (c.assumed_by) userIds.add(c.assumed_by);
    if (c.assigned_to) userIds.add(c.assigned_to);
    for (const m of messages) if (m.sent_by) userIds.add(m.sent_by);
    const userMap = new Map<string, { name: string; role: string }>();
    if (userIds.size) {
      const { data: us } = await this.supabase
        .from('users')
        .select('id, name, role')
        .in('id', [...userIds]);
      for (const u of (us ?? []) as Array<{ id: string; name: string; role: string }>)
        userMap.set(u.id, { name: u.name, role: u.role });
    }

    const sectorName = c.sectors?.name ?? null;
    const dataIso = c.closed_at || c.last_message_at || c.created_at;
    const dataDay = new Date(dataIso).toISOString().slice(0, 10);
    const ano = dataDay.slice(0, 4);
    const status = STATUS_MAP[c.status] ?? c.status;
    const contatoNome = c.wa_contact_name || c.wa_contact_number;

    const inbound = messages
      .filter((m) => m.direction === 'in' && !m.is_system && m.content)
      .slice(0, 3)
      .map((m) => m.content as string);
    const contexto = inbound.join(' ').slice(0, 1000) || 'Sem conteúdo textual inicial.';

    const eventos = messages
      .filter((m) => m.is_system && m.content)
      .map((m) => ({ ts: m.sent_at, tipo: 'sistema', descricao: m.content as string }));

    const lastOut =
      [...messages].reverse().find((m) => m.direction === 'out' && !m.is_system && m.content)?.content ?? '';
    const resolucao =
      c.status === 'closed'
        ? `Atendimento encerrado${c.close_reason ? ` (${c.close_reason})` : ''}.` +
          (lastOut ? ` Última resposta: ${lastOut}` : '')
        : `Status atual: ${status}.` + (lastOut ? ` Última resposta: ${lastOut}` : '');

    const participantes = [...userMap.values()].map((u) => ({
      nome: u.name,
      papel: u.role,
      setor: sectorName,
    }));

    const json = {
      id: c.id,
      data: dataDay,
      municipio: c.municipality ?? null,
      assunto: c.subject ?? null,
      setor: sectorName,
      status,
      canal: 'canal-oficial',
      contato: { nome: c.wa_contact_name ?? null, numero: c.wa_contact_number },
      participantes,
      contexto,
      resolucao,
      eventos,
      tags: [] as string[],
      mensagens_total: messages.length,
      exportado_em: new Date().toISOString(),
    };

    const md = [
      '---',
      `id: ${c.id}`,
      `data: ${dataDay}`,
      `municipio: ${c.municipality ?? ''}`,
      `assunto: ${c.subject ?? ''}`,
      `setor: ${sectorName ?? ''}`,
      `status: ${status}`,
      'canal: canal-oficial',
      `contato: ${contatoNome} (${c.wa_contact_number})`,
      `participantes: [${participantes.map((p) => p.nome).join(', ')}]`,
      `mensagens_total: ${messages.length}`,
      `exportado_em: ${json.exportado_em}`,
      '---',
      '',
      `# Atendimento — ${c.subject ?? 'Sem assunto'}${c.municipality ? ` · ${c.municipality}` : ''}`,
      '',
      '## Contexto',
      contexto,
      '',
      '## Andamento',
      ...(eventos.length ? eventos.map((e) => `- ${e.descricao}`) : ['- (sem eventos registrados)']),
      '',
      '## Resolução',
      resolucao,
      '',
    ].join('\n');

    const base = `conversas/${slugify(c.municipality ?? 'sem-municipio')}/${ano}/${dataDay}_${slugify(
      c.subject ?? 'sem-assunto',
    )}_${c.id.slice(0, 8)}`;

    // Regenera: remove exportações anteriores desta conversa e insere as novas.
    await this.supabase.from('context_files').delete().eq('canal_conversation_id', c.id);
    const now = new Date().toISOString();
    const { error } = await this.supabase.from('context_files').insert([
      {
        canal_conversation_id: c.id,
        file_type: 'md',
        content: md,
        message_count: messages.length,
        github_path: `${base}.md`,
        status: 'pending',
        generated_at: now,
      },
      {
        canal_conversation_id: c.id,
        file_type: 'json',
        content: JSON.stringify(json, null, 2),
        message_count: messages.length,
        github_path: `${base}.json`,
        status: 'pending',
        generated_at: now,
      },
    ]);
    if (error) this.logger.error(`export insert falhou: ${error.message}`);
    else this.logger.log(`export gerado p/ ${c.id} → ${base}`);
  }
}
