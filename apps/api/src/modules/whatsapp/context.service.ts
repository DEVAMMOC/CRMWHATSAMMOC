import { Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);

  constructor(private readonly supabase: SupabaseClient) {}

  async generateMd(conversationId: string): Promise<void> {
    // Fetch conversation (join owner name via foreign key embed)
    const { data: conv, error: convError } = await this.supabase
      .from('conversations')
      .select('*, owner_user_id(name)')
      .eq('id', conversationId)
      .single();

    if (convError || !conv) {
      this.logger.error(`generateMd: conversation ${conversationId} not found`);
      return;
    }

    // Fetch messages ordered by sent_at ascending
    const { data: messages } = await this.supabase
      .from('messages')
      .select('direction, content, sent_at, message_type')
      .eq('conversation_id', conversationId)
      .order('sent_at', { ascending: true });

    const ownerName: string =
      (conv.owner_user_id as unknown as { name: string } | null)?.name ?? 'N/A';
    const sharedAt = conv.shared_at
      ? new Date(conv.shared_at as string).toLocaleString('pt-BR')
      : '—';
    const startedAt = new Date(conv.created_at as string).toLocaleString('pt-BR');

    const lines: string[] = [
      `# Conversa: ${conv.contact_name || conv.contact_number}`,
      '',
      `**Contato:** ${conv.contact_number}`,
      `**Atendente:** ${ownerName}`,
      `**Início:** ${startedAt}`,
      `**Compartilhado em:** ${sharedAt}`,
      '',
      '---',
      '',
      '## Mensagens',
      '',
    ];

    for (const msg of messages ?? []) {
      const dir = (msg.direction as string) === 'in' ? '📨 Contato' : '📤 Sistema';
      const ts  = new Date(msg.sent_at as string).toLocaleString('pt-BR');
      lines.push(`**${ts} [${dir}]:** ${msg.content || '[mídia]'}`);
      lines.push('');
    }

    const content = lines.join('\n');

    const { error } = await this.supabase.from('context_files').upsert(
      {
        conversation_id: conversationId,
        file_type: 'md',
        content,
        message_count: (messages ?? []).length,
        github_path: `conversations/${conversationId}.md`,
        status: 'pending',
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'conversation_id,file_type' },
    );

    if (error) this.logger.error(`generateMd upsert failed: ${error.message}`);
    else this.logger.log(`MD generated for conversation ${conversationId}`);
  }
}
