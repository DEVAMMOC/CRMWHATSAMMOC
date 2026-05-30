import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import type { AppUser, SectorMemberUser } from '@crmwhats/types';
import type { UpdateProfileDto } from './dto/update-profile.dto';

/**
 * Public-safe column projection — excludes secret fields
 * (evolution_instance_id, evolution_instance_token) that must never
 * be exposed via the users list API. Mirrors the SectorsService precedent.
 */
const SAFE_USER_COLUMNS =
  'id, email, name, role, whatsapp_number, whatsapp_status, is_online, created_at';

@Injectable()
export class UsersService {
  constructor(private readonly supabase: SupabaseClient) {}

  async findById(id: string): Promise<AppUser> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Usuário não encontrado');
    return data as AppUser;
  }

  async findAll(): Promise<SectorMemberUser[]> {
    const { data, error } = await this.supabase
      .from('users')
      .select(SAFE_USER_COLUMNS)
      .order('name');

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SectorMemberUser[];
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<AppUser> {
    const { data, error } = await this.supabase
      .from('users')
      .update(dto)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Usuário não encontrado');
    return data as AppUser;
  }

  async setOnline(id: string, isOnline: boolean): Promise<void> {
    const { error } = await this.supabase
      .from('users')
      .update({ is_online: isOnline })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }
}
