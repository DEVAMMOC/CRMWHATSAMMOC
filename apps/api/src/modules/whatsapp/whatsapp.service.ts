import { randomUUID } from 'node:crypto';
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { EvolutionService } from './evolution.service';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly evolution: EvolutionService,
    private readonly supabase: SupabaseClient,
    private readonly apiPublicUrl: string,
  ) {}

  async getUserRow(userId: string) {
    const { data, error } = await this.supabase
      .from('users')
      .select('evolution_instance_id, evolution_instance_token, whatsapp_status')
      .eq('id', userId)
      .single();
    if (error) throw new Error(error.message);
    return data as {
      evolution_instance_id: string | null;
      evolution_instance_token: string | null;
      whatsapp_status: string;
    };
  }

  async connect(userId: string): Promise<void> {
    const user = await this.getUserRow(userId);

    if (user.whatsapp_status === 'connected') {
      throw new BadRequestException('WhatsApp já está conectado. Desconecte primeiro.');
    }

    const instanceName = `user-${userId}`;

    // createOrFindInstance handles the "already exists" case gracefully —
    // returns the real token stored in Evolution Go (may differ from DB if
    // the instance was created in a previous session that never saved back).
    const result = await this.evolution.createOrFindInstance(
      instanceName,
      user.evolution_instance_token ?? randomUUID(),
    );

    // Persist the authoritative instanceId + token before connecting,
    // so the webhook handler can identify the user when messages arrive.
    const { error: updateError } = await this.supabase
      .from('users')
      .update({
        evolution_instance_id: result.id,
        evolution_instance_token: result.token,
        whatsapp_status: 'connecting',
      })
      .eq('id', userId);
    if (updateError) throw new Error(updateError.message);

    // Webhook URL carries the token so we can look up the user on each event.
    const webhookUrl = `${this.apiPublicUrl}/api/webhook/whatsapp?token=${result.token}`;
    await this.evolution.connectInstance(result.token, webhookUrl);
  }

  async getQR(userId: string): Promise<{ base64: string }> {
    const user = await this.getUserRow(userId);
    if (!user.evolution_instance_token) throw new BadRequestException('WhatsApp not connected');
    return this.evolution.getQR(user.evolution_instance_token);
  }

  async pair(userId: string, phone: string): Promise<{ code: string }> {
    const user = await this.getUserRow(userId);
    if (!user.evolution_instance_token) throw new BadRequestException('WhatsApp not connected');
    return this.evolution.pairInstance(user.evolution_instance_token, phone);
  }

  async getStatus(userId: string): Promise<{ status: string; instanceId: string | null }> {
    const user = await this.getUserRow(userId);

    // If there is a live instance token, sync the real-time status from
    // Evolution Go so the DB stays accurate without relying on webhooks.
    if (user.evolution_instance_token && user.whatsapp_status !== 'disconnected') {
      try {
        const evo = await this.evolution.getStatus(user.evolution_instance_token);
        if (evo.status !== user.whatsapp_status) {
          await this.supabase
            .from('users')
            .update({ whatsapp_status: evo.status })
            .eq('id', userId);
          return { status: evo.status, instanceId: user.evolution_instance_id };
        }
      } catch {
        // Evolution Go unreachable — return last known DB status
      }
    }

    return {
      status: user.whatsapp_status,
      instanceId: user.evolution_instance_id,
    };
  }

  async sendMessage(userId: string, conversationId: string, text: string): Promise<void> {
    const user = await this.getUserRow(userId);
    if (!user.evolution_instance_token) throw new BadRequestException('WhatsApp não está conectado');

    // Resolve contact number from the conversation (RLS ensures ownership)
    const { data: conv, error: convErr } = await this.supabase
      .from('conversations')
      .select('contact_number')
      .eq('id', conversationId)
      .single();
    if (convErr || !conv) throw new BadRequestException('Conversa não encontrada');

    // Evolution Go will format the JID (formatJid: true in sendText)
    const to = (conv as { contact_number: string }).contact_number;

    // Send via Evolution Go
    await this.evolution.sendText(user.evolution_instance_token, to, text);

    const now = new Date().toISOString();

    // Persist outgoing message
    await this.supabase.from('messages').insert({
      conversation_id: conversationId,
      direction: 'out',
      content: text,
      message_type: 'text',
      sent_at: now,
    });

    // Keep last_message_at fresh so the conversation floats to the top
    await this.supabase
      .from('conversations')
      .update({ last_message_at: now })
      .eq('id', conversationId);
  }

  async sendMediaMessage(
    userId: string,
    conversationId: string,
    mediaUrl: string,
    mediaType: 'image' | 'video' | 'audio' | 'document',
    fileName: string,
    caption?: string,
  ): Promise<void> {
    const user = await this.getUserRow(userId);
    if (!user.evolution_instance_token) throw new BadRequestException('WhatsApp não está conectado');

    // Resolve contact number from the conversation (RLS ensures ownership)
    const { data: conv, error: convErr } = await this.supabase
      .from('conversations')
      .select('contact_number')
      .eq('id', conversationId)
      .single();
    if (convErr || !conv) throw new BadRequestException('Conversa não encontrada');

    // Evolution Go will format the JID (formatJid: true in sendMedia)
    const to = (conv as { contact_number: string }).contact_number;

    // Send via Evolution Go
    await this.evolution.sendMedia(user.evolution_instance_token, to, mediaUrl, mediaType, fileName, caption);

    const now = new Date().toISOString();

    // Persist outgoing media message — mirrors sendMessage's shape, plus media_url
    await this.supabase.from('messages').insert({
      conversation_id: conversationId,
      direction: 'out',
      content: caption || fileName,
      message_type: mediaType,
      media_url: mediaUrl,
      sent_at: now,
    });

    // Keep last_message_at fresh so the conversation floats to the top
    await this.supabase
      .from('conversations')
      .update({ last_message_at: now })
      .eq('id', conversationId);
  }

  async syncConversations(userId: string): Promise<{ synced: number; historyRequested: number }> {
    const user = await this.getUserRow(userId);
    if (!user.evolution_instance_token) throw new BadRequestException('WhatsApp não está conectado');

    const contacts = await this.evolution.getContacts(user.evolution_instance_token);
    this.logger.log(`Sync: fetched ${contacts.length} contacts for user ${userId}`);

    const historyRequested = 0;

    // Build deduped conversation rows (skip groups/broadcast). Dedup by contact_number
    // so a single batch upsert never hits the same conflict key twice.
    const seen = new Set<string>();
    const rows: Array<{ owner_user_id: string; contact_number: string; contact_name: string; status: string }> = [];
    for (const contact of contacts) {
      if (contact.Jid.endsWith('@g.us')) continue;
      if (contact.Jid === 'status@broadcast') continue;
      const contactNumber = contact.Jid.split('@')[0];
      if (seen.has(contactNumber)) continue;
      seen.add(contactNumber);
      const contactName =
        contact.FullName?.trim() ||
        contact.PushName?.trim() ||
        contact.BusinessName?.trim() ||
        contactNumber;
      rows.push({ owner_user_id: userId, contact_number: contactNumber, contact_name: contactName, status: 'nao_salva' });
    }

    // Batch upsert — one round-trip per chunk instead of thousands of sequential
    // upserts (which exceeded the proxy timeout and surfaced as a 500). With ~2k
    // contacts this is a handful of calls and completes in a couple of seconds.
    // ignoreDuplicates: true keeps existing status/name for conversations that exist.
    let synced = 0;
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await this.supabase.from('conversations').upsert(chunk, {
        onConflict: 'owner_user_id,contact_number',
        ignoreDuplicates: true,
      });
      if (error) {
        this.logger.warn(`Sync: batch upsert failed (rows ${i}-${i + chunk.length}): ${error.message}`);
      } else {
        synced += chunk.length;
      }
    }

    // Histórico sob demanda está desativado: esta build do Evolution Go não expõe
    // um endpoint de history funcional (POST /chat/history-sync-request retorna 404)
    // nem um endpoint para buscar mensagens. Apenas mensagens novas (e o que o
    // WhatsApp empurra ao vincular o aparelho, via MESSAGES_SET) são armazenadas.
    // O sync apenas importa os contatos/conversas e retorna rápido (evita timeout).
    this.logger.log(`Sync complete: ${synced} conversations imported for user ${userId}`);
    return { synced, historyRequested };
  }

  async disconnect(userId: string): Promise<void> {
    const user = await this.getUserRow(userId);
    if (user.evolution_instance_id) {
      try {
        await this.evolution.deleteInstance(user.evolution_instance_id);
      } catch {
        // Best-effort: clear DB even if Evolution Go fails
      }
    }
    const { error: clearError } = await this.supabase
      .from('users')
      .update({
        evolution_instance_id: null,
        evolution_instance_token: null,
        whatsapp_status: 'disconnected',
      })
      .eq('id', userId);
    if (clearError) throw new Error(clearError.message);
  }
}
