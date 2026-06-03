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

@Controller('canal/conversations')
@UseGuards(AuthGuard)
export class CanalInboxController {
  constructor(private readonly convs: CanalConversationService) {}

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
  close(@Param('id') id: string) {
    return this.convs.close(id);
  }

  @Post(':id/status')
  setStatus(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CanalStatusDto,
  ) {
    return this.convs.setStatus(id, dto.status, user.id);
  }
}
