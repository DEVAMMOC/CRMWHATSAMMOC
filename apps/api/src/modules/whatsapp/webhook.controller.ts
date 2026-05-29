import { Controller, Post, Body, Query, Logger } from '@nestjs/common';
import { WebhookService } from './webhook.service';

interface WebhookPayload {
  event: string;
  data: Record<string, unknown>;
  [key: string]: unknown;
}

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly webhookService: WebhookService) {}

  @Post('whatsapp')
  async handleWhatsApp(
    @Query('token') token: string,
    @Body() payload: WebhookPayload,
  ): Promise<{ ok: boolean }> {
    if (!token) {
      this.logger.warn('Webhook called without token query param');
      return { ok: false };
    }

    try {
      await this.webhookService.handleEvent(token, {
        event: payload.event ?? '',
        data: (payload.data ?? payload) as Record<string, unknown>,
      });
    } catch (err) {
      this.logger.error('Webhook processing error', err);
    }

    return { ok: true };
  }
}
