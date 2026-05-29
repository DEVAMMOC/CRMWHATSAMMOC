import {
  Controller, Post, Get, Delete, Body, UseGuards, InternalServerErrorException, Logger,
} from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { WhatsAppService } from './whatsapp.service';
import { PairDto } from './dto/pair.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('whatsapp')
@UseGuards(AuthGuard)
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(private readonly whatsapp: WhatsAppService) {}

  @Post('connect')
  async connect(@CurrentUser() user: User) {
    try {
      await this.whatsapp.connect(user.id);
      return { status: 'connecting' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`connect failed for ${user.id}: ${msg}`);
      throw new InternalServerErrorException(msg);
    }
  }

  @Get('qr')
  getQR(@CurrentUser() user: User) {
    return this.whatsapp.getQR(user.id);
  }

  @Post('pair')
  pair(@CurrentUser() user: User, @Body() dto: PairDto) {
    return this.whatsapp.pair(user.id, dto.phone);
  }

  @Get('status')
  getStatus(@CurrentUser() user: User) {
    return this.whatsapp.getStatus(user.id);
  }

  @Post('send')
  async send(@CurrentUser() user: User, @Body() dto: SendMessageDto) {
    try {
      await this.whatsapp.sendMessage(user.id, dto.conversationId, dto.text);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`send failed for ${user.id}: ${msg}`);
      throw new InternalServerErrorException(msg);
    }
  }

  @Delete('disconnect')
  async disconnect(@CurrentUser() user: User) {
    await this.whatsapp.disconnect(user.id);
    return { status: 'disconnected' };
  }
}
