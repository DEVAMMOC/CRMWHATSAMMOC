import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Encerramento automático de conversas do Canal inativas.
 *
 * Nota sobre `attendances`: a tabela `attendances` referencia `public.conversations`
 * (conversas pessoais), NÃO `canal_conversations`. Portanto este job NÃO toca em
 * `attendances` — apenas encerra as conversas do canal.
 */
@Injectable()
export class CanalSchedulerService {
  private readonly logger = new Logger(CanalSchedulerService.name);

  constructor(private readonly supabase: SupabaseClient) {}

  @Cron(CronExpression.EVERY_HOUR)
  async closeInactiveConversations(): Promise<void> {
    const cutoff = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.supabase
      .from('canal_conversations')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        close_reason: 'timeout',
      })
      .eq('status', 'human')
      .lt('last_message_at', cutoff)
      .select('id');
    if (error) {
      this.logger.error(`auto-close failed: ${error.message}`);
      return;
    }
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (ids.length)
      this.logger.log(
        `Auto-encerradas ${ids.length} conversa(s) do canal por inatividade (8h)`,
      );
  }
}
