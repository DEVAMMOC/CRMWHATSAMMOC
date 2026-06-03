import {
  Controller, Param, Post, Body, UseGuards, Inject,
  ForbiddenException, NotFoundException, InternalServerErrorException, BadRequestException, Logger,
} from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { SupabaseClient } from '@supabase/supabase-js';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ContextService } from './context.service';
import { DelegateDto } from './dto/delegate.dto';

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

    // Compartilhar deixa a conversa ATIVA na hora (sem etapa de aceitação no /recebidos).
    const { error: updateError } = await this.supabase
      .from('conversations')
      .update({
        status: 'ativa',
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

    return { message: 'Conversa compartilhada e visível no painel', status: 'ativa' };
  }

  @Post(':id/delegate')
  async delegate(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: DelegateDto,
  ) {
    const { data: conv, error } = await this.supabase
      .from('conversations')
      .select('id, owner_user_id, status')
      .eq('id', id)
      .single();

    if (error || !conv) throw new NotFoundException('Conversa não encontrada');

    // Authorization: admin/supervisor can delegate any conversation;
    // a regular employee may only delegate conversations they own.
    const { data: me } = await this.supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();
    if (me?.role !== 'admin' && me?.role !== 'supervisor' && conv.owner_user_id !== user.id) {
      throw new ForbiddenException('Sem permissão para delegar esta conversa');
    }

    // When delegating to a specific user within a sector, ensure membership.
    if (dto.sectorId && dto.assignedTo) {
      const { data: membership } = await this.supabase
        .from('sector_members')
        .select('user_id')
        .eq('sector_id', dto.sectorId)
        .eq('user_id', dto.assignedTo)
        .maybeSingle();
      if (!membership) throw new BadRequestException('Usuário não pertence ao setor');
    }

    const updates: Record<string, unknown> = {
      delegated_at: new Date().toISOString(),
      delegated_by: user.id,
    };
    if (dto.sectorId !== undefined) updates['sector_id'] = dto.sectorId;
    if (dto.assignedTo !== undefined) updates['assigned_to'] = dto.assignedTo;
    if (conv.status === 'nao_salva') updates['status'] = 'pendente';

    const { error: updateError } = await this.supabase
      .from('conversations')
      .update(updates)
      .eq('id', id);

    if (updateError) {
      this.logger.error(`Failed to delegate conversation ${id}: ${updateError.message}`);
      if ((updateError as { code?: string }).code === '23503') {
        throw new BadRequestException('Setor ou usuário informado não existe');
      }
      throw new InternalServerErrorException('Erro ao delegar conversa');
    }

    return { message: 'Conversa delegada com sucesso', sectorId: dto.sectorId, assignedTo: dto.assignedTo };
  }
}
