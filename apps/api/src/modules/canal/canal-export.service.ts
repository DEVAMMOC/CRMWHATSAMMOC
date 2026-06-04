import { Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { buildExportFiles, ExportParticipante } from '../../common/conversation-export';
import { AiService } from '../../common/ai.service';

const STATUS_MAP: Record<string, string> = {
  open: 'aberta',
  human: 'em_atendimento',
  closed: 'encerrada',
};

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
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly ai: AiService,
  ) {}

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
    const status = STATUS_MAP[c.status] ?? c.status;

    const inbound = messages
      .filter((m) => m.direction === 'in' && !m.is_system && m.content)
      .slice(0, 3)
      .map((m) => m.content as string);

    const eventos = messages
      .filter((m) => m.is_system && m.content)
      .map((m) => ({ ts: m.sent_at, tipo: 'sistema', descricao: m.content as string }));

    const lastOut =
      [...messages].reverse().find((m) => m.direction === 'out' && !m.is_system && m.content)?.content ?? '';

    // Resumo determinístico (fallback). Se o agente de IA estiver ativo + auto_summarize,
    // substitui por um resumo melhor.
    let contexto = inbound.join(' ').slice(0, 1000) || 'Sem conteúdo textual inicial.';
    let resolucao =
      c.status === 'closed'
        ? `Atendimento encerrado${c.close_reason ? ` (${c.close_reason})` : ''}.` +
          (lastOut ? ` Última resposta: ${lastOut}` : '')
        : `Status atual: ${status}.` + (lastOut ? ` Última resposta: ${lastOut}` : '');
    try {
      const transcript = messages
        .filter((m) => !m.is_system && m.content)
        .map((m) => `${m.direction === 'in' ? 'Cidadão' : 'Atendente'}: ${m.content}`)
        .join('\n');
      const ai = await this.ai.summarize(transcript);
      if (ai) {
        if (ai.contexto) contexto = ai.contexto;
        if (ai.resolucao) resolucao = ai.resolucao;
      }
    } catch (e) {
      this.logger.warn(`auto-resumo IA falhou: ${e instanceof Error ? e.message : String(e)}`);
    }

    const participantes: ExportParticipante[] = [...userMap.values()].map((u) => ({
      nome: u.name,
      papel: u.role,
      setor: sectorName,
    }));

    const { basePath: base, md, json } = buildExportFiles({
      id: c.id,
      canal: 'canal-oficial',
      contatoNome: c.wa_contact_name,
      contatoNumero: c.wa_contact_number,
      municipio: c.municipality ?? null,
      assunto: c.subject ?? null,
      setor: sectorName,
      statusLabel: status,
      dataDay,
      participantes,
      contexto,
      resolucao,
      eventos,
      mensagensTotal: messages.length,
    });

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
