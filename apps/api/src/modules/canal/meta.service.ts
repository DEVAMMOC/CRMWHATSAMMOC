import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';

const GRAPH = 'https://graph.facebook.com/v21.0';

export interface MetaSendResult {
  ok: boolean;
  error?: string;
  wa_message_id?: string;
}

@Injectable()
export class MetaService {
  private readonly logger = new Logger(MetaService.name);
  constructor(private readonly supabase: SupabaseClient) {}

  private async config(): Promise<{
    access_token: string;
    app_secret: string;
    verify_token: string;
  } | null> {
    const { data } = await this.supabase
      .from('canal_config')
      .select('access_token, app_secret, verify_token')
      .limit(1)
      .single();
    return (
      (data as {
        access_token: string;
        app_secret: string;
        verify_token: string;
      } | null) ?? null
    );
  }

  /** Webhook GET handshake: retorna o challenge se o verify_token bate. */
  async verifyChallenge(
    mode: string,
    token: string,
    challenge: string,
  ): Promise<string | null> {
    const cfg = await this.config();
    if (mode === 'subscribe' && cfg && token && token === cfg.verify_token)
      return challenge;
    return null;
  }

  /** Valida X-Hub-Signature-256 (sha256=<hmac do corpo cru com app_secret>). */
  async verifySignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<boolean> {
    const cfg = await this.config();
    // Fail-open enquanto o App Secret não foi configurado: sem o segredo é
    // impossível validar a assinatura. Aceita (com aviso) para permitir o setup
    // inicial; assim que o App Secret é salvo, a validação passa a ser exigida.
    if (!cfg?.app_secret) {
      this.logger.warn('Canal webhook: app_secret não configurado — aceitando sem validar assinatura. Configure o App Secret para ativar a validação.');
      return true;
    }
    if (!signatureHeader) return false;
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', cfg.app_secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** Envia mensagem de texto pelo número (phone_number_id) informado. */
  async sendText(
    phoneNumberId: string,
    to: string,
    text: string,
  ): Promise<MetaSendResult> {
    const cfg = await this.config();
    if (!cfg?.access_token)
      return { ok: false, error: 'Canal não configurado (access_token ausente)' };
    const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id: string }>;
      error?: { message: string };
    };
    if (!res.ok)
      return { ok: false, error: body.error?.message ?? `Graph ${res.status}` };
    return { ok: true, wa_message_id: body.messages?.[0]?.id };
  }

  /** Testa o token chamando GET /{phone_number_id}. */
  async testConnection(
    phoneNumberId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const cfg = await this.config();
    if (!cfg?.access_token) return { ok: false, error: 'access_token ausente' };
    const res = await fetch(`${GRAPH}/${phoneNumberId}`, {
      headers: { Authorization: `Bearer ${cfg.access_token}` },
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as {
        error?: { message: string };
      };
      return { ok: false, error: b.error?.message ?? `Graph ${res.status}` };
    }
    return { ok: true };
  }
}
