import {
  Controller, Post, Get, Delete, Body, Query, UseGuards, InternalServerErrorException, Logger,
} from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { WhatsAppService } from './whatsapp.service';
import { EvolutionService } from './evolution.service';
import { PairDto } from './dto/pair.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SendMediaDto } from './dto/send-media.dto';

@Controller('whatsapp')
@UseGuards(AuthGuard)
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly evolution: EvolutionService,
  ) {}

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

  @Post('send-media')
  async sendMedia(@CurrentUser() user: User, @Body() dto: SendMediaDto) {
    try {
      await this.whatsapp.sendMediaMessage(user.id, dto.conversationId, dto.mediaUrl, dto.mediaType, dto.fileName, dto.caption);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`send-media failed for ${user.id}: ${msg}`);
      throw new InternalServerErrorException(msg);
    }
  }

  @Post('sync')
  async sync(@CurrentUser() user: User) {
    try {
      return await this.whatsapp.syncConversations(user.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`sync failed for ${user.id}: ${msg}`);
      throw new InternalServerErrorException(msg);
    }
  }

  /** GET /api/whatsapp/avatar?number=554799168804 — proxies WhatsApp profile photo */
  @Get('avatar')
  async getAvatar(@CurrentUser() user: User, @Query('number') number: string) {
    if (!number) return { url: null };
    try {
      const userRow = await this.whatsapp.getUserRow(user.id);
      if (!userRow.evolution_instance_token) return { url: null };
      const url = await this.evolution.getContactAvatar(userRow.evolution_instance_token, number);
      return { url };
    } catch {
      return { url: null };
    }
  }

  @Delete('disconnect')
  async disconnect(@CurrentUser() user: User) {
    await this.whatsapp.disconnect(user.id);
    return { status: 'disconnected' };
  }
}
