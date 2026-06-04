import { Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { buildExportFiles, ExportParticipante } from '../../common/conversation-export';
import { AiService } from '../../common/ai.service';

const STATUS_MAP: Record<string, string> = {
  nao_salva: 'aberta',
  pendente: 'aberta',
  ativa: 'em_atendimento',
  encerrada: 'encerrada',
};

/**
 * Gera o export unificado (.md + .json) de uma conversa do **número pessoal**
 * compartilhada, no MESMO formato e pasta `/conversas/{municipio}/{ano}/` usado
 * pelo Canal, e grava em `context_files` como `pending` (o GithubSyncService publica).
 */
@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly ai: AiService,
  ) {}

  async generateMd(conversationId: string): Promise<void> {
    const { data: conv, error: convError } = await this.supabase
      .from('conversations')
      .select('*, owner:owner_user_id(name, role), assigned:assigned_to(name, role), sectors(name)')
      .eq('id', conversationId)
      .single();

    if (convError || !conv) {
      this.logger.error(`generateMd: conversa ${conversationId} não encontrada`);
      return;
    }
    const c = conv as Record<string, unknown> & {
      id: string;
      contact_name: string | null;
      contact_number: string;
      status: string;
      municipality: string | null;
      subject: string | null;
      created_at: string;
      shared_at: string | null;
      last_message_at: string | null;
      owner: { name: string; role: string } | null;
      assigned: { name: string; role: string } | null;
      sectors: { name: string } | null;
    };

    // Exporta SÓ o trecho a partir do compartilhamento (evita histórico fora de
    // contexto anterior ao "compartilhada"). Sem shared_at, exporta tudo.
    let msgQuery = this.supabase
      .from('messages')
      .select('direction, content, sent_at')
      .eq('conversation_id', conversationId);
    if (c.shared_at) msgQuery = msgQuery.gte('sent_at', c.shared_at);
    const { data: msgs } = await msgQuery.order('sent_at', { ascending: true });
    const messages = (msgs ?? []) as Array<{ direction: string; content: string | null; sent_at: string }>;

    const sectorName = c.sectors?.name ?? null;
    const dataIso = c.last_message_at || c.shared_at || c.created_at;
    const dataDay = new Date(dataIso).toISOString().slice(0, 10);
    const status = STATUS_MAP[c.status] ?? c.status;

    const inbound = messages
      .filter((m) => m.direction === 'in' && m.content)
      .slice(0, 3)
      .map((m) => m.content as string);
    const lastOut =
      [...messages].reverse().find((m) => m.direction === 'out' && m.content)?.content ?? '';

    // Resumo determinístico (fallback) + IA quando ativa (auto_summarize).
    let contexto = inbound.join(' ').slice(0, 1000) || 'Sem conteúdo textual inicial.';
    let resolucao =
      c.status === 'encerrada'
        ? `Atendimento encerrado.${lastOut ? ` Última resposta: ${lastOut}` : ''}`
        : `Status atual: ${status}.${lastOut ? ` Última resposta: ${lastOut}` : ''}`;
    try {
      const transcript = messages
        .filter((m) => m.content)
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

    const participantes: ExportParticipante[] = [];
    if (c.owner?.name)
      participantes.push({ nome: c.owner.name, papel: c.owner.role ?? 'funcionario', setor: sectorName });
    if (c.assigned?.name && c.assigned.name !== c.owner?.name)
      participantes.push({ nome: c.assigned.name, papel: c.assigned.role ?? 'funcionario', setor: sectorName });

    const { basePath, md, json } = buildExportFiles({
      id: c.id,
      canal: 'numero-pessoal',
      contatoNome: c.contact_name,
      contatoNumero: c.contact_number,
      municipio: c.municipality ?? null,
      assunto: c.subject ?? null,
      setor: sectorName,
      statusLabel: status,
      dataDay,
      participantes,
      contexto,
      resolucao,
      eventos: [],
      mensagensTotal: messages.length,
    });

    await this.supabase.from('context_files').delete().eq('conversation_id', c.id);
    const now = new Date().toISOString();
    const { error } = await this.supabase.from('context_files').insert([
      {
        conversation_id: c.id,
        file_type: 'md',
        content: md,
        message_count: messages.length,
        github_path: `${basePath}.md`,
        status: 'pending',
        generated_at: now,
      },
      {
        conversation_id: c.id,
        file_type: 'json',
        content: JSON.stringify(json, null, 2),
        message_count: messages.length,
        github_path: `${basePath}.json`,
        status: 'pending',
        generated_at: now,
      },
    ]);

    if (error) this.logger.error(`generateMd insert falhou: ${error.message}`);
    else this.logger.log(`export pessoal gerado p/ ${c.id} → ${basePath}`);
  }
}
