import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { MetaService } from './meta.service';
import { mimeToExt } from '../../common/mime';

@Injectable()
export class CanalConversationService {
  private readonly logger = new Logger(CanalConversationService.name);
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly meta: MetaService,
  ) {}

  /** Webhook inbound: cria/atualiza conversa e grava a mensagem recebida. */
  async ingestInbound(params: {
    phoneNumberId: string;
    from: string;
    name: string | null;
    waMessageId: string;
    content: string;
    tsISO: string;
    messageType?: 'text' | 'image' | 'video' | 'audio' | 'document';
    mediaId?: string | null;
    fileName?: string | null;
  }): Promise<void> {
    const messageType = params.messageType ?? 'text';
    const { data: num } = await this.supabase
      .from('canal_numbers')
      .select('id, active')
      .eq('phone_number_id', params.phoneNumberId)
      .single();
    if (!num || !(num as { active: boolean }).active) {
      this.logger.warn(
        `Canal: número desconhecido/inativo ${params.phoneNumberId}`,
      );
      return;
    }
    const numberId = (num as { id: string }).id;

    const { data: conv, error: convErr } = await this.supabase
      .from('canal_conversations')
      .upsert(
        {
          canal_number_id: numberId,
          wa_contact_number: params.from,
          wa_contact_name: params.name,
          last_in_at: params.tsISO,
          last_message_at: params.tsISO,
          // status: omitido — INSERT usa default 'open'; em conflito não reseta delegação.
          // Reabrir se estava 'closed' é feito abaixo.
        },
        {
          onConflict: 'canal_number_id,wa_contact_number',
          ignoreDuplicates: false,
        },
      )
      .select('id, status')
      .single();
    if (convErr || !conv) {
      this.logger.error(`Canal: erro upsert conversa: ${convErr?.message}`);
      return;
    }
    const c = conv as { id: string; status: string };
    if (c.status === 'closed') {
      await this.supabase
        .from('canal_conversations')
        .update({ status: 'open' })
        .eq('id', c.id);
    }
    await this.supabase.from('canal_messages').upsert(
      {
        conversation_id: c.id,
        direction: 'in',
        content: params.content || (messageType === 'text' ? '[mídia]' : ''),
        message_type: messageType,
        media_url: null,
        wa_message_id: params.waMessageId,
        sent_at: params.tsISO,
      },
      { onConflict: 'wa_message_id', ignoreDuplicates: true },
    );

    if (messageType !== 'text' && params.mediaId) {
      void this.downloadAndStoreCanal(params.mediaId, c.id, params.waMessageId).catch((e) =>
        this.logger.warn(`Canal: falha download mídia ${params.waMessageId}: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  }

  private async downloadAndStoreCanal(
    mediaId: string,
    conversationId: string,
    waMessageId: string,
  ): Promise<void> {
    const media = await this.meta.downloadMedia(mediaId);
    if (!media) { this.logger.warn(`Canal: downloadMedia vazio ${waMessageId}`); return; }
    const ext = mimeToExt(media.mime);
    const safeId = waMessageId.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `canal/${conversationId}/${safeId}.${ext}`;
    const up = await this.supabase.storage
      .from('wa-media')
      .upload(path, media.buffer, { contentType: media.mime, upsert: true });
    if (up.error) { this.logger.error(`Canal: upload storage falhou: ${up.error.message}`); return; }
    const { data: pub } = this.supabase.storage.from('wa-media').getPublicUrl(path);
    await this.supabase.from('canal_messages')
      .update({ media_url: pub.publicUrl })
      .eq('wa_message_id', waMessageId);
    this.logger.log(`Canal: mídia salva ${waMessageId} → ${path}`);
  }

  async list(): Promise<unknown[]> {
    const { data } = await this.supabase
      .from('canal_conversations')
      .select('*, canal_numbers(label, display_number)')
      .order('last_message_at', { ascending: false });
    return data ?? [];
  }

  async messages(conversationId: string): Promise<unknown[]> {
    const { data } = await this.supabase
      .from('canal_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('sent_at', { ascending: true });
    return data ?? [];
  }

  /** Funcionário/admin responde pela inbox → envia via Meta e grava 'out'. */
  async reply(
    conversationId: string,
    userId: string,
    text: string,
  ): Promise<void> {
    const { data: conv } = await this.supabase
      .from('canal_conversations')
      .select('id, wa_contact_number, last_in_at, assigned_to, canal_numbers(phone_number_id)')
      .eq('id', conversationId)
      .single();
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    const cc = conv as unknown as {
      wa_contact_number: string;
      last_in_at: string | null;
      assigned_to: string | null;
      canal_numbers: { phone_number_id: string };
    };

    // Janela de 24h da Meta para mensagens livres.
    if (
      !cc.last_in_at ||
      Date.now() - new Date(cc.last_in_at).getTime() > 24 * 60 * 60 * 1000
    ) {
      throw new BadRequestException(
        'Fora da janela de 24h da Meta — requer template aprovado (indisponível na Fase 1).',
      );
    }
    const result = await this.meta.sendText(
      cc.canal_numbers.phone_number_id,
      cc.wa_contact_number,
      text,
    );
    if (!result.ok)
      throw new BadRequestException(result.error ?? 'Falha ao enviar pela Meta');
    const now = new Date().toISOString();
    await this.supabase.from('canal_messages').insert({
      conversation_id: conversationId,
      direction: 'out',
      content: text,
      wa_message_id: result.wa_message_id ?? null,
      sent_by: userId,
      sent_at: now,
    });
    const patch: Record<string, unknown> = { last_message_at: now, status: 'human' };
    if (!cc.assigned_to) patch.assigned_to = userId;
    await this.supabase
      .from('canal_conversations')
      .update(patch)
      .eq('id', conversationId);
  }

  /** Funcionário/admin envia mídia pela inbox → Meta + grava 'out'. */
  async sendMediaMessage(
    conversationId: string,
    userId: string,
    mediaUrl: string,
    mediaType: 'image' | 'audio' | 'video' | 'document',
    fileName: string,
    caption?: string,
  ): Promise<void> {
    const { data: conv } = await this.supabase
      .from('canal_conversations')
      .select('wa_contact_number, last_in_at, assigned_to, canal_numbers(phone_number_id)')
      .eq('id', conversationId)
      .single();
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    const cc = conv as unknown as {
      wa_contact_number: string;
      last_in_at: string | null;
      assigned_to: string | null;
      canal_numbers: { phone_number_id: string };
    };
    if (!cc.last_in_at || Date.now() - new Date(cc.last_in_at).getTime() > 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Fora da janela de 24h da Meta — requer template aprovado (indisponível na Fase 1).');
    }
    const result = await this.meta.sendMedia(
      cc.canal_numbers.phone_number_id, cc.wa_contact_number, mediaType, mediaUrl, caption, fileName,
    );
    if (!result.ok) throw new BadRequestException(result.error ?? 'Falha ao enviar mídia pela Meta');
    const now = new Date().toISOString();
    await this.supabase.from('canal_messages').insert({
      conversation_id: conversationId,
      direction: 'out',
      content: caption || fileName,
      message_type: mediaType,
      media_url: mediaUrl,
      wa_message_id: result.wa_message_id ?? null,
      sent_by: userId,
      sent_at: now,
    });
    const patch: Record<string, unknown> = { last_message_at: now, status: 'human' };
    if (!cc.assigned_to) patch.assigned_to = userId;
    await this.supabase
      .from('canal_conversations')
      .update(patch)
      .eq('id', conversationId);
  }

  /** Evento interno na timeline (pílula no chat). Não envia nada à Meta. */
  private async systemEvent(conversationId: string, text: string): Promise<void> {
    const now = new Date().toISOString();
    await this.supabase.from('canal_messages').insert({
      conversation_id: conversationId,
      direction: 'out',
      content: text,
      message_type: 'text',
      is_system: true,
      sent_at: now,
    });
    // Sobe a conversa na lista (igual reply/sendMedia) — p/ a conversa delegada
    // aparecer no topo do painel do destinatário.
    await this.supabase
      .from('canal_conversations')
      .update({ last_message_at: now })
      .eq('id', conversationId);
  }

  /** Aviso ao cidadão por WhatsApp, só se dentro da janela de 24h da Meta. */
  private async notifyCitizen(conversationId: string, text: string): Promise<void> {
    const { data } = await this.supabase
      .from('canal_conversations')
      .select('wa_contact_number, last_in_at, canal_numbers(phone_number_id)')
      .eq('id', conversationId)
      .single();
    const c = data as unknown as {
      wa_contact_number: string; last_in_at: string | null;
      canal_numbers: { phone_number_id: string };
    } | null;
    if (!c) return;
    if (!c.last_in_at || Date.now() - new Date(c.last_in_at).getTime() > 24 * 60 * 60 * 1000) {
      this.logger.log(`notifyCitizen ${conversationId}: fora da janela 24h — só evento interno`);
      return;
    }
    const r = await this.meta.sendText(c.canal_numbers.phone_number_id, c.wa_contact_number, text);
    if (!r.ok) this.logger.warn(`notifyCitizen falhou: ${r.error}`);
  }

  private async userName(id: string | null): Promise<string> {
    if (!id) return 'a equipe';
    const { data } = await this.supabase.from('users').select('name').eq('id', id).single();
    return (data as { name: string } | null)?.name ?? 'a equipe';
  }

  private async sectorName(id: string | null): Promise<string> {
    if (!id) return '';
    const { data } = await this.supabase.from('sectors').select('name').eq('id', id).single();
    return (data as { name: string } | null)?.name ?? '';
  }

  async delegate(
    conversationId: string,
    sectorId: string | null,
    assignedTo: string | null,
  ): Promise<void> {
    const { data: prev } = await this.supabase
      .from('canal_conversations')
      .select('assigned_to')
      .eq('id', conversationId)
      .single();
    const prevAssigned = (prev as { assigned_to: string | null } | null)?.assigned_to ?? null;

    const { error } = await this.supabase
      .from('canal_conversations')
      .update({ sector_id: sectorId, assigned_to: assignedTo, status: 'open' })
      .eq('id', conversationId);
    if (error) throw new BadRequestException(error.message);

    if (assignedTo && prevAssigned && assignedTo !== prevAssigned) {
      const nome = await this.userName(assignedTo);
      await this.systemEvent(conversationId, `↪️ Direcionado para ${nome}`);
      await this.notifyCitizen(conversationId, `Seu atendimento foi direcionado para ${nome}.`).catch(() => {});
    } else if (sectorId) {
      const setor = await this.sectorName(sectorId);
      await this.systemEvent(conversationId, `🔀 Delegado ao setor ${setor}`);
      await this.notifyCitizen(conversationId, `Seu atendimento foi encaminhado ao setor ${setor}.`).catch(() => {});
    }

    if (assignedTo) {
      await this.notifyAssignment(conversationId, assignedTo, sectorId).catch((e) =>
        this.logger.warn(`Falha ao notificar delegação: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  }

  /** Funcionário assume a conversa (Aguardando → Em atendimento). */
  async assume(conversationId: string, userId: string): Promise<void> {
    const { data: conv } = await this.supabase
      .from('canal_conversations')
      .select('assigned_to')
      .eq('id', conversationId)
      .single();
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from('canal_conversations')
      .update({ status: 'human', assigned_to: userId, assumed_by: userId, assumed_at: now })
      .eq('id', conversationId);
    if (error) throw new BadRequestException(error.message);
    const nome = await this.userName(userId);
    await this.systemEvent(conversationId, `✋ ${nome} assumiu o atendimento`);
    await this.notifyCitizen(conversationId, `Olá! Sou ${nome} e vou seguir com o seu atendimento.`).catch(() => {});
  }

  /** Atualiza assunto/cidade da conversa do Canal. */
  async setMeta(
    conversationId: string,
    patch: { subject?: string | null; municipality?: string | null },
  ): Promise<void> {
    const updates: Record<string, unknown> = {};
    if (patch.subject !== undefined) updates.subject = patch.subject;
    if (patch.municipality !== undefined) updates.municipality = patch.municipality;
    if (Object.keys(updates).length === 0) return;
    const { error } = await this.supabase
      .from('canal_conversations')
      .update(updates)
      .eq('id', conversationId);
    if (error) throw new BadRequestException(error.message);
  }

  /** Cria uma notificação in-app para o funcionário responsável pela conversa. */
  private async notifyAssignment(
    conversationId: string,
    userId: string,
    sectorId: string | null,
  ): Promise<void> {
    const { data: conv } = await this.supabase
      .from('canal_conversations')
      .select('wa_contact_name, wa_contact_number')
      .eq('id', conversationId)
      .single();
    let sectorName = '';
    if (sectorId) {
      const { data: sec } = await this.supabase
        .from('sectors')
        .select('name')
        .eq('id', sectorId)
        .single();
      sectorName = (sec as { name: string } | null)?.name ?? '';
    }
    const c = conv as { wa_contact_name: string | null; wa_contact_number: string } | null;
    const contato = c?.wa_contact_name || c?.wa_contact_number || 'cidadão';
    await this.supabase.from('notifications').insert({
      user_id: userId,
      type: 'delegation',
      title: 'Nova conversa delegada a você',
      body: sectorName ? `${contato} — setor ${sectorName}` : `${contato}`,
      link: '/canal',
    });
  }

  async close(conversationId: string): Promise<void> {
    await this.supabase
      .from('canal_conversations')
      .update({ status: 'closed' })
      .eq('id', conversationId);
  }

  /** Altera o status de uma conversa (usado pelo Kanban de atendimento). */
  async setStatus(
    conversationId: string,
    status: string,
    userId: string,
  ): Promise<void> {
    if (!['open', 'human', 'closed'].includes(status)) {
      throw new BadRequestException(`Status inválido: ${status}`);
    }
    const patch: Record<string, unknown> =
      status === 'closed'
        ? {
            status,
            closed_at: new Date().toISOString(),
            closed_by: userId,
            close_reason: 'manual',
          }
        : { status, closed_at: null, closed_by: null, close_reason: null };
    const { error } = await this.supabase
      .from('canal_conversations')
      .update(patch)
      .eq('id', conversationId);
    if (error) throw new BadRequestException(error.message);
  }
}
