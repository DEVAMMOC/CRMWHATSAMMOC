import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient, UserResponse } from '@supabase/supabase-js';

@Injectable()
export class SupabaseAdminService {
  private client: SupabaseClient;

  constructor(private config: ConfigService) {
    this.client = createClient(
      this.config.getOrThrow<string>('supabase.url'),
      this.config.getOrThrow<string>('supabase.serviceRoleKey'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  async getUser(token: string): Promise<UserResponse> {
    return this.client.auth.getUser(token);
  }

  /** Remove o usuário do auth. Idempotente: tolera "não encontrado" (status 404),
   *  para que re-executar a exclusão de um usuário parcialmente removido convirja. */
  async deleteAuthUser(id: string): Promise<void> {
    const { error } = await this.client.auth.admin.deleteUser(id);
    if (error && (error as { status?: number }).status !== 404) {
      throw new Error(error.message);
    }
  }
}
