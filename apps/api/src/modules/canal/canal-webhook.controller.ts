import { Controller, Get, Post, Query, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MetaService } from './meta.service';
import { CanalConversationService } from './canal-conversation.service';
import { CanalClassifyService } from './canal-classify.service';

@Controller('canal/webhook')
export class CanalWebhookController {
  private readonly logger = new Logger(CanalWebhookController.name);
  constructor(
    private readonly meta: MetaService,
    private readonly convs: CanalConversationService,
    private readonly classify: CanalClassifyService,
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
            image?: { id: string; caption?: string; mime_type?: string };
            video?: { id: string; caption?: string; mime_type?: string };
            audio?: { id: string; mime_type?: string };
            document?: { id: string; caption?: string; filename?: string; mime_type?: string };
            sticker?: { id: string; mime_type?: string };
          }>;
        };
        const phoneNumberId = value.metadata?.phone_number_id ?? '';
        const name = value.contacts?.[0]?.profile?.name ?? null;
        for (const m of value.messages ?? []) {
          const tsISO = new Date(Number(m.timestamp) * 1000).toISOString();
          const TYPE_MAP: Record<string, 'image' | 'video' | 'audio' | 'document'> = {
            image: 'image', video: 'video', audio: 'audio', document: 'document', sticker: 'image',
          };
          const messageType = TYPE_MAP[m.type];
          if (!messageType) {
            // texto (ou tipo não suportado → guarda como texto/placeholder)
            await this.convs.ingestInbound({
              phoneNumberId, from: m.from, name,
              waMessageId: m.id, content: m.type === 'text' ? (m.text?.body ?? '') : '[mídia]',
              tsISO,
            });
          } else {
            const media = (m as Record<string, { id?: string; caption?: string; filename?: string }>)[m.type];
            const caption = media?.caption ?? '';
            const fileName = media?.filename ?? null;
            await this.convs.ingestInbound({
              phoneNumberId, from: m.from, name,
              waMessageId: m.id, content: caption || fileName || '',
              tsISO, messageType, mediaId: media?.id ?? null, fileName,
            });
          }
          // Classificação por IA (modos suggest/auto; só se ainda sem setor/sugestão) — não bloqueia.
          void this.classify.maybeClassifyByContact(phoneNumberId, m.from).catch(() => undefined);
        }
      }
    }
    return res.status(200).send('ok'); // sempre 200 rápido p/ a Meta não reenviar
  }
}
