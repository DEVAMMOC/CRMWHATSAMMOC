import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CanalConversationService } from './canal-conversation.service';
import { CanalSendMessageDto } from './dto/send-message.dto';
import { CanalDelegateDto } from './dto/delegate.dto';

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

  @Post(':id/delegate')
  delegate(@Param('id') id: string, @Body() dto: CanalDelegateDto) {
    return this.convs.delegate(id, dto.sectorId ?? null, dto.assignedTo ?? null);
  }

  @Post(':id/close')
  close(@Param('id') id: string) {
    return this.convs.close(id);
  }
}
