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

    // Reuse existing token or create new one
    const token = user.evolution_instance_token ?? randomUUID();
    const instanceName = `user-${userId}`;

    let instanceId = user.evolution_instance_id;
    if (!instanceId) {
      const result = await this.evolution.createInstance(instanceName, token);
      instanceId = result.id ?? result.name ?? instanceName;
    }

    // Persist token + instanceId before connecting (so we can handle webhook)
    const { error: updateError } = await this.supabase
      .from('users')
      .update({
        evolution_instance_id: instanceId,
        evolution_instance_token: token,
        whatsapp_status: 'connecting',
      })
      .eq('id', userId);
    if (updateError) throw new Error(updateError.message);

    // Webhook URL includes token as query param so we can identify the user
    const webhookUrl = `${this.apiPublicUrl}/api/webhook/whatsapp?token=${token}`;
    await this.evolution.connectInstance(token, webhookUrl);
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
