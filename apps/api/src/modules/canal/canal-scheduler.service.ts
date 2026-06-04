import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { CanalExportService } from './canal-export.service';
import { GithubSyncService } from './github-sync.service';

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

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly exportSvc: CanalExportService,
    private readonly githubSync: GithubSyncService,
  ) {}

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
    if (ids.length) {
      this.logger.log(
        `Auto-encerradas ${ids.length} conversa(s) do canal por inatividade (8h)`,
      );
      // Exporta cada conversa encerrada p/ o Segundo Cérebro (não bloqueia o cron).
      for (const id of ids) {
        await this.exportSvc.buildAndStore(id).catch((e) =>
          this.logger.warn(`export auto-close ${id}: ${e instanceof Error ? e.message : String(e)}`),
        );
      }
    }
  }

  /** Reenvia ao GitHub os exports pendentes/falhos (resiliência). */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async syncSecondBrain(): Promise<void> {
    await this.githubSync.syncPending().catch((e) =>
      this.logger.warn(`sync segundo-cérebro: ${e instanceof Error ? e.message : String(e)}`),
    );
  }
}
