import { Controller, Get, Post, Query, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MetaService } from './meta.service';
import { CanalConversationService } from './canal-conversation.service';

@Controller('canal/webhook')
export class CanalWebhookController {
  private readonly logger = new Logger(CanalWebhookController.name);
  constructor(
    private readonly meta: MetaService,
    private readonly convs: CanalConversationService,
  ) {}

  @Get()
  async verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const ok = await this.meta.verifyChallenge(mode, token, challenge);
    if (ok) return res.status(200).send(ok);
    return res.status(403).send('forbidden');
  }

  @Post()
  async receive(@Req() req: Request, @Res() res: Response) {
    // Requer o corpo CRU para validar a assinatura — ver bootstrap em main.ts.
    const raw: Buffer =
      (req as unknown as { rawBody?: Buffer }).rawBody ??
      Buffer.from(JSON.stringify(req.body ?? {}));
    const sig = req.header('x-hub-signature-256');
    if (!(await this.meta.verifySignature(raw, sig))) {
      this.logger.warn('Canal webhook: assinatura inválida');
      return res.status(401).send('invalid signature');
    }

    const body = req.body as {
      entry?: Array<{ changes?: Array<{ value?: Record<string, unknown> }> }>;
    };
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = (change.value ?? {}) as {
          metadata?: { phone_number_id?: string };
          contacts?: Array<{ profile?: { name?: string } }>;
          messages?: Array<{
            from: string;
            id: string;
            timestamp: string;
            type: string;
            text?: { body: string };
          }>;
        };
        const phoneNumberId = value.metadata?.phone_number_id ?? '';
        const name = value.contacts?.[0]?.profile?.name ?? null;
        for (const m of value.messages ?? []) {
          const content =
            m.type === 'text' ? (m.text?.body ?? '') : '[mídia]';
          const tsISO = new Date(Number(m.timestamp) * 1000).toISOString();
          await this.convs.ingestInbound({
            phoneNumberId,
            from: m.from,
            name,
            waMessageId: m.id,
            content,
            tsISO,
          });
        }
      }
    }
    return res.status(200).send('ok'); // sempre 200 rápido p/ a Meta não reenviar
  }
}
