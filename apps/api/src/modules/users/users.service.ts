import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import type { AppUser } from '@crmwhats/types';
import type { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly supabase: SupabaseClient) {}

  async findById(id: string): Promise<AppUser> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundException('Usuário não encontrado');
    return data as AppUser;
  }

  async findAll(): Promise<AppUser[]> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .order('name');

    if (error) throw new Error(error.message);
    return (data ?? []) as AppUser[];
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<AppUser> {
    const { data, error } = await this.supabase
      .from('users')
      .update(dto)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) throw new NotFoundException('Usuário não encontrado');
    return data as AppUser;
  }

  async setOnline(id: string, isOnline: boolean): Promise<void> {
    await this.supabase
      .from('users')
      .update({ is_online: isOnline })
      .eq('id', id);
  }
}
