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

    // Evolution Go (whatsmeow) sends { Info: {...}, Message: {...} } with capitalized
    // top-level keys; older Evolution API (Baileys) sends { key, message, messageTimestamp }.
    // Support both shapes. (Temporary verbose log to confirm the payload shape in prod.)
    this.logger.log(`webhook payload: ${JSON.stringify(data).slice(0, 1500)}`);

    const info = (data['Info'] ?? data['info']) as Record<string, unknown> | undefined;
    const message = (data['Message'] ?? data['message']) as Record<string, unknown> | undefined;
    const key = data['key'] as Record<string, unknown> | undefined;

    const pick = (obj: Record<string, unknown> | undefined, ...keys: string[]): unknown => {
      if (!obj) return undefined;
      for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
      return undefined;
    };

    // Chat JID (conversation peer). whatsmeow: Info.Chat; Baileys: key.remoteJid.
    const remoteJid = (pick(info, 'Chat', 'chat') ?? pick(key, 'remoteJid') ?? data['remoteJid'] ?? '') as string;
    const messageId = (pick(info, 'ID', 'id') ?? pick(key, 'id') ?? data['id'] ?? '') as string;
    const fromMe = (pick(info, 'IsFromMe', 'isFromMe') ?? pick(key, 'fromMe') ?? false) as boolean;
    const pushName = (pick(info, 'PushName', 'pushName') ?? '') as string;
    const direction: 'in' | 'out' = fromMe ? 'out' : 'in';

    // Message content — several shapes (whatsmeow proto / Baileys).
    const extText = pick(message, 'extendedTextMessage', 'ExtendedTextMessage') as Record<string, unknown> | undefined;
    const imgMsg = pick(message, 'imageMessage', 'ImageMessage') as Record<string, unknown> | undefined;
    const vidMsg = pick(message, 'videoMessage', 'VideoMessage') as Record<string, unknown> | undefined;
    const content = (
      (pick(message, 'conversation', 'Conversation') as string | undefined) ??
      (pick(extText, 'text', 'Text') as string | undefined) ??
      (pick(imgMsg, 'caption', 'Caption') as string | undefined) ??
      (pick(vidMsg, 'caption', 'Caption') as string | undefined) ??
      ''
    );

    if (!remoteJid || !messageId) {
      this.logger.warn(`Webhook: missing jid/id (jid='${remoteJid}', id='${messageId}') — keys: ${Object.keys(data).join(',')}`);
      return;
    }

    // Skip groups, status broadcasts and newsletters
    if (remoteJid.endsWith('@g.us')) { this.logger.debug(`Skipping group ${remoteJid}`); return; }
    if (remoteJid === 'status@broadcast') { this.logger.debug('Skipping status broadcast'); return; }
    if (remoteJid.endsWith('@newsletter')) { this.logger.debug('Skipping newsletter'); return; }

    const contactNumber = remoteJid.split('@')[0];
    // Use the sender's WhatsApp display name for incoming messages when available.
    const contactName = (!fromMe && pushName) ? pushName : contactNumber;

    // Timestamp — whatsmeow: Info.Timestamp (RFC3339 string); Baileys: messageTimestamp (unix sec).
    const ts = pick(info, 'Timestamp', 'timestamp') ?? data['messageTimestamp'];
    let sentAt: string;
    if (typeof ts === 'number') {
      sentAt = new Date(ts * 1000).toISOString();
    } else if (typeof ts === 'string' && ts) {
      const d = new Date(ts);
      sentAt = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    } else {
      sentAt = new Date().toISOString();
    }

    // Upsert conversation — atomic, no read-then-write race.
    // DB unique constraint: (owner_user_id, contact_number).
    const { data: convRow, error: convError } = await this.supabase
      .from('conversations')
      .upsert(
        {
          owner_user_id: (userRow as { id: string }).id,
          contact_number: contactNumber,
          contact_name: contactName,
          // status omitted on purpose: INSERT uses the column default ('nao_salva'),
          // and on conflict (UPDATE) we must NOT reset a shared/delegated status.
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
