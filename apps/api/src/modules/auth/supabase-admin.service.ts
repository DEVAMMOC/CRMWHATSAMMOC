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

  async deleteAuthUser(id: string): Promise<void> {
    const { error } = await this.client.auth.admin.deleteUser(id);
    if (error) throw new Error(error.message);
  }
}
