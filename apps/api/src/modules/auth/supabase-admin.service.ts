import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseAdminService {
  private client: SupabaseClient;

  constructor(private config: ConfigService) {
    this.client = createClient(
      this.config.get<string>('supabase.url') ?? '',
      this.config.get<string>('supabase.serviceRoleKey') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  async getUser(token: string) {
    return this.client.auth.getUser(token);
  }
}
