import { Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { AiService } from '../../common/ai.service';
import { CanalConversationService } from './canal-conversation.service';

/**
 * Classificação de atendimentos do Canal por IA → setor. Respeita o
 * `agent_config.classify_mode`: off | manual | suggest | auto.
 * - suggest: grava `suggested_sector_id` (mostra no card; humano confirma).
 * - auto: delega ao setor automaticamente.
 * - manual: só roda quando chamado pelo botão (force).
 */
@Injectable()
export class CanalClassifyService {
  private readonly logger = new Logger(CanalClassifyService.name);
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly ai: AiService,
    private readonly convs: CanalConversationService,
  ) {}

  /** Após mensagem nova: classifica se ainda não tem setor/sugestão (modos suggest/auto). */
  async maybeClassifyByContact(phoneNumberId: string, from: string): Promise<void> {
    const cfg = await this.ai.config();
    if (!cfg || (cfg.classify_mode !== 'suggest' && cfg.classify_mode !== 'auto')) return;
    const { data: num } = await this.supabase
      .from('canal_numbers')
      .select('id')
      .eq('phone_number_id', phoneNumberId)
      .single();
    if (!num) return;
    const { data: conv } = await this.supabase
      .from('canal_conversations')
      .select('id, sector_id, suggested_sector_id, status')
      .eq('canal_number_id', (num as { id: string }).id)
      .eq('wa_contact_number', from)
      .single();
    const c = conv as { id: string; sector_id: string | null; suggested_sector_id: string | null; status: string } | null;
    if (!c || c.sector_id || c.suggested_sector_id || c.status === 'closed') return;
    await this.classifyOne(c.id, false).catch((e) =>
      this.logger.warn(`classify ${c.id}: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  /** Classifica uma conversa. `force` ignora o gate de modo (usado pelo botão manual). */
  async classifyOne(conversationId: string, force: boolean): Promise<{ sectorId: string | null }> {
    const cfg = await this.ai.config();
    const mode = cfg?.classify_mode ?? 'off';
    if (!cfg || (!force && mode !== 'suggest' && mode !== 'auto')) return { sectorId: null };

    const { data: secs } = await this.supabase.from('sectors').select('id, name');
    const sectors = (secs ?? []) as Array<{ id: string; name: string }>;
    if (!sectors.length) return { sectorId: null };

    const { data: msgs } = await this.supabase
      .from('canal_messages')
      .select('direction, content')
      .eq('conversation_id', conversationId)
      .order('sent_at', { ascending: true })
      .limit(20);
    const text = ((msgs ?? []) as Array<{ direction: string; content: string | null }>)
      .map((m) => `${m.direction === 'in' ? 'Cidadão' : 'Atendente'}: ${m.content ?? ''}`)
      .join('\n');

    const res = await this.ai.classifySector(text, sectors);
    const sectorId = res?.sectorId ?? null;
    if (!sectorId) return { sectorId: null };

    if (mode === 'auto') {
      // delega de fato (gera evento de sistema + aviso ao cidadão)
      await this.convs.delegate(conversationId, sectorId, null);
    } else {
      await this.supabase
        .from('canal_conversations')
        .update({ suggested_sector_id: sectorId })
        .eq('id', conversationId);
    }
    return { sectorId };
  }
}
