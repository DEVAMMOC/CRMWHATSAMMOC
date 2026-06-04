import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CanalConversationService } from './canal-conversation.service';
import { CanalSendMessageDto } from './dto/send-message.dto';
import { CanalDelegateDto } from './dto/delegate.dto';
import { CanalStatusDto } from './dto/status.dto';
import { CanalSendMediaDto } from './dto/send-media.dto';
import { CanalSetMetaDto } from './dto/set-meta.dto';
import { CanalExportService } from './canal-export.service';
import { GithubSyncService } from './github-sync.service';

@Controller('canal/conversations')
@UseGuards(AuthGuard)
export class CanalInboxController {
  constructor(
    private readonly convs: CanalConversationService,
    private readonly exportSvc: CanalExportService,
    private readonly githubSync: GithubSyncService,
  ) {}

  /** Exporta a conversa p/ o Segundo Cérebro e dá push (fire-and-forget). */
  private exportToSecondBrain(id: string): void {
    void this.exportSvc
      .buildAndStore(id)
      .then(() => this.githubSync.syncPending())
      .catch(() => undefined);
  }

  @Get()
  list() {
    return this.convs.list();
  }

  @Get(':id/messages')
  messages(@Param('id') id: string) {
    return this.convs.messages(id);
  }

  @Post(':id/message')
  reply(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CanalSendMessageDto,
  ) {
    return this.convs.reply(id, user.id, dto.text);
  }

  @Post(':id/send-media')
  sendMedia(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CanalSendMediaDto,
  ) {
    return this.convs.sendMediaMessage(id, user.id, dto.mediaUrl, dto.mediaType, dto.fileName, dto.caption);
  }

  @Post(':id/delegate')
  delegate(@Param('id') id: string, @Body() dto: CanalDelegateDto) {
    return this.convs.delegate(id, dto.sectorId ?? null, dto.assignedTo ?? null);
  }

  @Post(':id/assume')
  assume(@CurrentUser() user: User, @Param('id') id: string) {
    return this.convs.assume(id, user.id);
  }

  @Post(':id/meta')
  setMeta(@Param('id') id: string, @Body() dto: CanalSetMetaDto) {
    return this.convs.setMeta(id, { subject: dto.subject, municipality: dto.municipality });
  }

  @Post(':id/close')
  async close(@Param('id') id: string) {
    await this.convs.close(id);
    this.exportToSecondBrain(id);
    return { ok: true };
  }

  @Post(':id/status')
  async setStatus(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CanalStatusDto,
  ) {
    await this.convs.setStatus(id, dto.status, user.id);
    if (dto.status === 'closed') this.exportToSecondBrain(id);
    return { ok: true };
  }
}
