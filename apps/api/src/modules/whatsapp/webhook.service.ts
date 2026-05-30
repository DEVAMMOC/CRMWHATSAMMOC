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

    // Evolution Go uses "Message" (mixed-case); older versions use "messages.upsert" or "MESSAGE"
    if (event === 'messages.upsert' || event === 'MESSAGE' || event === 'Message') {
      await this.handleMessage(instanceToken, data);
    } else if (event === 'MESSAGES_SET' || event === 'messages.set') {
      // Bulk history sync — data.messages is an array of message objects
      await this.handleMessagesSet(instanceToken, data);
    } else if (event === 'connection.update') {
      await this.handleConnectionUpdate(instanceToken, data);
    } else {
      this.logger.log(`Unhandled webhook event: ${event}`);
    }
  }

  private async handleMessage(token: string, data: Record<string, unknown>): Promise<void> {
    this.logger.log(`handleMessage called — keys: ${Object.keys(data).join(', ')}`);
    // Find owner by instance token
    const { data: userRow, error: userError } = await this.supabase
      .from('users')
      .select('id')
      .eq('evolution_instance_token', token)
      .single();
    if (userError) { this.logger.error(`DB error looking up user by token: ${userError.message}`); return; }

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

    // Skip group messages — remoteJid ends with @g.us
    if (remoteJid.endsWith('@g.us')) {
      this.logger.debug(`Skipping group message from ${remoteJid}`);
      return;
    }

    // Skip WhatsApp status broadcasts
    if (remoteJid === 'status@broadcast') {
      this.logger.debug('Skipping status@broadcast message');
      return;
    }

    // Normalize contact number.
    // @s.whatsapp.net  → plain phone number (e.g. "5547999168804")
    // @lid             → WhatsApp privacy LID; we try to use a phone number from
    //                    the pushName path. The raw LID number is kept as fallback
    //                    so the conversation is at least created and visible.
    const rawLocal = remoteJid.split('@')[0];
    // LID numbers are typically large integers (>10 digits) without a "+" prefix.
    // Real phone numbers in international format start with country code digits.
    // We store whatever we have — LID or phone — as the contact identifier.
    const contactNumber = rawLocal;

    // Persist messageTimestamp from the webhook payload
    const msgTimestamp = data['messageTimestamp'] as number | undefined;
    const sentAt = msgTimestamp
      ? new Date(msgTimestamp * 1000).toISOString()
      : new Date().toISOString();

    // Upsert conversation — atomic, no read-then-write race.
    // DB unique constraint: (owner_user_id, contact_number).
    const { data: convRow, error: convError } = await this.supabase
      .from('conversations')
      .upsert(
        {
          owner_user_id: (userRow as { id: string }).id,
          contact_number: contactNumber,
          contact_name: contactNumber,
          status: 'nao_salva',
          last_message_at: sentAt,
        },
        {
          onConflict: 'owner_user_id,contact_number',
          // Update last_message_at on conflict so the row stays fresh
          ignoreDuplicates: false,
        },
      )
      .select('id')
      .single();

    if (convError || !convRow) {
      this.logger.error(`DB error upserting conversation: ${convError?.message ?? 'no row returned'}`);
      return;
    }

    const convId = convRow.id as string;

    // Insert message (ignore if duplicate evolution_message_id)
    const { error: msgError } = await this.supabase.from('messages').upsert(
      {
        conversation_id: convId,
        direction,
        content: content || '[mídia]',
        message_type: 'text',
        evolution_message_id: messageId,
        sent_at: sentAt,
      },
      { onConflict: 'evolution_message_id', ignoreDuplicates: true },
    );
    if (msgError) {
      this.logger.error(`DB error upserting message: ${msgError.message}`);
    } else {
      this.logger.log(`Message saved — conv:${convId} dir:${direction} contact:${contactNumber}`);
    }
  }

  /**
   * Handle MESSAGES_SET — bulk history sync payload.
   * Evolution Go sends this when history-sync-request completes.
   * data.messages is an array of message objects with the same shape as individual MESSAGE events.
   */
  private async handleMessagesSet(token: string, data: Record<string, unknown>): Promise<void> {
    const messages = (data['messages'] ?? data['data'] ?? []) as Record<string, unknown>[];
    if (!Array.isArray(messages) || messages.length === 0) {
      this.logger.log(`MESSAGES_SET received but no messages array found. Keys: ${Object.keys(data).join(', ')}`);
      return;
    }
    this.logger.log(`MESSAGES_SET: processing ${messages.length} historical messages`);
    let saved = 0;
    for (const msg of messages) {
      try {
        await this.handleMessage(token, msg);
        saved++;
      } catch (e) {
        this.logger.warn(`MESSAGES_SET: failed to process message: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.logger.log(`MESSAGES_SET complete: ${saved}/${messages.length} stored`);
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
