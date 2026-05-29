import { Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

interface EvolutionMessageEvent {
  event: string;
  data: Record<string, unknown>;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(private readonly supabase: SupabaseClient) {}

  async handleEvent(instanceToken: string, payload: EvolutionMessageEvent): Promise<void> {
    const { event, data } = payload;

    if (event === 'messages.upsert' || event === 'MESSAGE') {
      await this.handleMessage(instanceToken, data);
    } else if (event === 'connection.update') {
      await this.handleConnectionUpdate(instanceToken, data);
    } else {
      this.logger.debug(`Unhandled webhook event: ${event}`);
    }
  }

  private async handleMessage(token: string, data: Record<string, unknown>): Promise<void> {
    // Find owner by instance token
    const { data: userRow } = await this.supabase
      .from('users')
      .select('id')
      .eq('evolution_instance_token', token)
      .single();

    if (!userRow) {
      this.logger.warn(`Webhook: no user found for token ${token.slice(0, 8)}...`);
      return;
    }

    const key = data['key'] as Record<string, unknown> | undefined;
    const message = data['message'] as Record<string, unknown> | undefined;
    const remoteJid = (key?.['remoteJid'] ?? data['remoteJid'] ?? '') as string;
    const messageId = (key?.['id'] ?? data['id'] ?? '') as string;
    const fromMe = (key?.['fromMe'] ?? false) as boolean;
    const content = (
      (message?.['conversation'] as string | undefined) ??
      ((message?.['extendedTextMessage'] as Record<string, unknown> | undefined)?.['text'] as string | undefined) ??
      ''
    );
    const direction: 'in' | 'out' = fromMe ? 'out' : 'in';

    if (!remoteJid || !messageId) return;

    // Normalize contact number: strip @s.whatsapp.net / @g.us
    const contactNumber = remoteJid.split('@')[0];

    // Find or create conversation
    const { data: existing } = await this.supabase
      .from('conversations')
      .select('id')
      .eq('owner_user_id', userRow.id)
      .eq('contact_number', contactNumber)
      .single();

    let convId: string;

    if (existing) {
      convId = existing.id as string;
      await this.supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', convId);
    } else {
      const { data: newConv } = await this.supabase
        .from('conversations')
        .insert({
          owner_user_id: userRow.id,
          contact_number: contactNumber,
          contact_name: contactNumber,
          status: 'nao_salva',
          last_message_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (!newConv) {
        this.logger.error('Failed to insert conversation');
        return;
      }
      convId = newConv.id as string;
    }

    // Insert message (ignore if duplicate evolution_message_id)
    await this.supabase.from('messages').upsert(
      {
        conversation_id: convId,
        direction,
        content: content || '[mídia]',
        message_type: 'text',
        evolution_message_id: messageId,
      },
      { onConflict: 'evolution_message_id', ignoreDuplicates: true },
    );
  }

  private async handleConnectionUpdate(token: string, data: Record<string, unknown>): Promise<void> {
    const state = (data['state'] ?? data['connection'] ?? '') as string;
    const statusMap: Record<string, string> = {
      open: 'connected',
      connecting: 'connecting',
      close: 'disconnected',
      closed: 'disconnected',
      conflict: 'disconnected',
    };
    const whatsappStatus = statusMap[state] ?? 'disconnected';

    const { data: userRow } = await this.supabase
      .from('users')
      .select('id, whatsapp_number')
      .eq('evolution_instance_token', token)
      .single();

    if (!userRow) return;

    const updates: Record<string, unknown> = { whatsapp_status: whatsappStatus };
    const phone = data['phoneNumber'] as string | undefined;
    if (phone) updates['whatsapp_number'] = phone;

    await this.supabase.from('users').update(updates).eq('id', userRow.id);
    this.logger.log(`Connection update for user ${userRow.id}: ${state} → ${whatsappStatus}`);
  }
}
