import {
  Controller, Param, Post, Body, UseGuards, Inject,
  ForbiddenException, NotFoundException, InternalServerErrorException, BadRequestException, Logger,
} from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { SupabaseClient } from '@supabase/supabase-js';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ContextService } from './context.service';
import { GithubSyncService } from '../canal/github-sync.service';
import { DelegateDto } from './dto/delegate.dto';

@Controller('conversations')
@UseGuards(AuthGuard)
export class ConversationShareController {
  private readonly logger = new Logger(ConversationShareController.name);

  constructor(
    @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
    private readonly context: ContextService,
    private readonly githubSync: GithubSyncService,
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
    // Já ativa/pendente: nada a fazer. Encerrada ou não-salva: (re)compartilha,
    // reabrindo com um novo shared_at (o export passa a contar a partir daqui).
    if (conv.status === 'ativa' || conv.status === 'pendente')
      return { message: 'Conversa já compartilhada', status: conv.status };

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

    // Gera o export unificado (.md+.json) e publica no Segundo Cérebro — não-bloqueante.
    this.context
      .generateMd(id)
      .then(() => this.githubSync.syncPending())
      .catch((err: unknown) => {
        this.logger.error(`export/sync fire-and-forget falhou p/ conversa ${id}`, err);
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

  /** Encerra uma conversa pessoal compartilhada: marca encerrada, fecha o
   *  atendimento aberto e exporta SÓ o trecho compartilhada→encerrada. */
  @Post(':id/close')
  async close(@Param('id') id: string, @CurrentUser() user: User) {
    const { data: conv, error } = await this.supabase
      .from('conversations')
      .select('id, owner_user_id, status, sector_id')
      .eq('id', id)
      .single();
    if (error || !conv) throw new NotFoundException('Conversa não encontrada');

    const { data: me } = await this.supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();
    const role = (me as { role: string } | null)?.role;
    const isPriv = role === 'admin' || role === 'supervisor';
    if (!isPriv && conv.owner_user_id !== user.id) {
      // chefe de setor pode encerrar conversas do seu setor
      const lead = conv.sector_id
        ? await this.supabase
            .from('sector_members')
            .select('user_id')
            .eq('sector_id', conv.sector_id)
            .eq('user_id', user.id)
            .eq('lead', true)
            .maybeSingle()
        : { data: null };
      if (!lead.data) throw new ForbiddenException('Sem permissão para encerrar esta conversa');
    }

    const now = new Date().toISOString();
    const { error: upErr } = await this.supabase
      .from('conversations')
      .update({ status: 'encerrada' })
      .eq('id', id);
    if (upErr) throw new InternalServerErrorException('Erro ao encerrar conversa');

    // Fecha o atendimento aberto vinculado (se houver).
    await this.supabase
      .from('attendances')
      .update({ status: 'encerrado', closed_at: now })
      .eq('conversation_id', id)
      .neq('status', 'encerrado');

    // Exporta só o trecho compartilhada→encerrada e publica — não-bloqueante.
    this.context
      .generateMd(id)
      .then(() => this.githubSync.syncPending())
      .catch((err: unknown) => this.logger.error(`export/sync no encerramento ${id}`, err));

    return { ok: true, status: 'encerrada' };
  }
}
