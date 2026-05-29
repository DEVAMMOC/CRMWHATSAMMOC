import { randomUUID } from 'node:crypto';
import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { EvolutionService } from './evolution.service';

@Injectable()
export class WhatsAppService {
  constructor(
    private readonly evolution: EvolutionService,
    private readonly supabase: SupabaseClient,
    private readonly apiPublicUrl: string,
  ) {}

  private async getUserRow(userId: string) {
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
    return {
      status: user.whatsapp_status,
      instanceId: user.evolution_instance_id,
    };
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
