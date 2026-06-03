import { Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { EvolutionService } from './evolution.service';
import { mimeToExt, parseDataUrl } from '../../common/mime';

interface EvolutionMessageEvent {
  event: string;
  data: Record<string, unknown>;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly evolution: EvolutionService,
  ) {}

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
    // Support both shapes.
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
    // Tipos de mídia (whatsmeow proto / Baileys; camelCase no Message interno).
    const audioMsg = pick(message, 'audioMessage', 'AudioMessage') as Record<string, unknown> | undefined;
    const docMsg = pick(message, 'documentMessage', 'DocumentMessage') as Record<string, unknown> | undefined;
    const stickerMsg = pick(message, 'stickerMessage', 'StickerMessage') as Record<string, unknown> | undefined;

    let messageType: 'text' | 'image' | 'video' | 'audio' | 'document' = 'text';
    if (imgMsg || stickerMsg) messageType = 'image';
    else if (vidMsg) messageType = 'video';
    else if (audioMsg) messageType = 'audio';
    else if (docMsg) messageType = 'document';

    const docFileName = pick(docMsg, 'fileName', 'FileName', 'title', 'Title') as string | undefined;
    const content = (
      (pick(message, 'conversation', 'Conversation') as string | undefined) ??
      (pick(extText, 'text', 'Text') as string | undefined) ??
      (pick(imgMsg, 'caption', 'Caption') as string | undefined) ??
      (pick(vidMsg, 'caption', 'Caption') as string | undefined) ??
      (pick(docMsg, 'caption', 'Caption') as string | undefined) ??
      docFileName ??
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

    // Resolve the contact's phone number. Newer WhatsApp uses @lid (privacy) JIDs for
    // the chat; the real @s.whatsapp.net number is provided in RecipientAlt/SenderAlt/Sender.
    let peerJid = remoteJid;
    if (remoteJid.endsWith('@lid')) {
      const alts = [
        pick(info, 'RecipientAlt', 'recipientAlt'),
        pick(info, 'SenderAlt', 'senderAlt'),
        pick(info, 'Sender', 'sender'),
      ];
      const altPhone = alts.find((j): j is string => typeof j === 'string' && j.endsWith('@s.whatsapp.net'));
      if (altPhone) peerJid = altPhone;
    }
    const contactNumber = peerJid.split('@')[0];
    // Use the sender's WhatsApp display name for incoming messages when available.
    const contactName = (!fromMe && pushName) ? pushName : contactNumber;
    this.logger.log(`webhook msg: chat=${remoteJid} contact=${contactNumber} dir=${direction}`);

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
        content: content || (messageType === 'text' ? '[mídia]' : ''),
        message_type: messageType,
        evolution_message_id: messageId,
        sent_at: sentAt,
      },
      { onConflict: 'evolution_message_id', ignoreDuplicates: true },
    );
    if (msgError) {
      this.logger.error(`DB error upserting message: ${msgError.message}`);
      return;
    }
    this.logger.log(`Message saved — conv:${convId} dir:${direction} type:${messageType}`);

    // Mídia recebida: baixa em background e atualiza media_url quando pronto.
    if (messageType !== 'text' && direction === 'in') {
      void this.downloadAndStoreEvolution(
        token, message, messageType,
        (userRow as { id: string }).id, convId, messageId,
      ).catch((e) =>
        this.logger.warn(`Falha download mídia ${messageId}: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  }

  private async downloadAndStoreEvolution(
    token: string,
    message: Record<string, unknown> | undefined,
    messageType: string,
    ownerUserId: string,
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    const dataUrl = await this.evolution.downloadMedia(token, message);
    if (!dataUrl) { this.logger.warn(`downloadMedia vazio p/ ${messageId}`); return; }
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) { this.logger.warn(`data-url inválido p/ ${messageId}`); return; }
    const ext = mimeToExt(parsed.mime);
    const safeId = messageId.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `incoming/${ownerUserId}/${conversationId}/${safeId}.${ext}`;
    const up = await this.supabase.storage
      .from('wa-media')
      .upload(path, parsed.buffer, { contentType: parsed.mime, upsert: true });
    if (up.error) { this.logger.error(`upload storage falhou: ${up.error.message}`); return; }
    const { data: pub } = this.supabase.storage.from('wa-media').getPublicUrl(path);
    await this.supabase.from('messages')
      .update({ media_url: pub.publicUrl })
      .eq('evolution_message_id', messageId);
    this.logger.log(`Mídia salva ${messageId} → ${path}`);
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
