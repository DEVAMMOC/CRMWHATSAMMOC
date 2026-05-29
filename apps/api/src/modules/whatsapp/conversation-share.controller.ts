import {
  Controller, Param, Post, UseGuards, Inject,
  ForbiddenException, NotFoundException, InternalServerErrorException, Logger,
} from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { SupabaseClient } from '@supabase/supabase-js';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ContextService } from './context.service';

@Controller('conversations')
@UseGuards(AuthGuard)
export class ConversationShareController {
  private readonly logger = new Logger(ConversationShareController.name);

  constructor(
    @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
    private readonly context: ContextService,
  ) {}

  @Post(':id/share')
  async share(@Param('id') id: string, @CurrentUser() user: User) {
    // Verify conversation belongs to the caller
    const { data: conv, error } = await this.supabase
      .from('conversations')
      .select('id, owner_user_id, status')
      .eq('id', id)
      .single();

    if (error || !conv) throw new NotFoundException('Conversa não encontrada');
    if (conv.owner_user_id !== user.id) throw new ForbiddenException('Sem permissão');
    if (conv.status !== 'nao_salva') return { message: 'Conversa já compartilhada', status: conv.status };

    // Update status to pendente
    const { error: updateError } = await this.supabase
      .from('conversations')
      .update({
        status: 'pendente',
        shared_at: new Date().toISOString(),
        shared_by: user.id,
      })
      .eq('id', id);

    if (updateError) {
      this.logger.error(`Failed to share conversation ${id}: ${updateError.message}`);
      throw new InternalServerErrorException('Erro ao compartilhar conversa');
    }

    // Generate .md async — non-blocking
    this.context.generateMd(id).catch((err: unknown) => {
      this.logger.error(`generateMd fire-and-forget failed for conversation ${id}`, err);
    });

    return { message: 'Conversa compartilhada com a organização', status: 'pendente' };
  }
}
