import { ForbiddenException, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import type { SaveConfigDto } from './dto/save-config.dto';

const mask = (s: string) =>
  s && s.length > 4 ? '••••' + s.slice(-4) : s ? '••••' : '';

@Injectable()
export class CanalConfigService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Authorization for canal config management. Mirrors SectorsService: the role
   * lives in the `users` table (AppUser.role), not in Supabase auth metadata,
   * so we read it from there. Only admin/supervisor may mutate config/numbers.
   */
  async assertCanManage(userId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (error || !data) {
      throw new ForbiddenException('Usuário não encontrado');
    }

    const role = (data as { role: string }).role;
    if (role !== 'admin' && role !== 'supervisor') {
      throw new ForbiddenException(
        'Apenas admin ou supervisor podem gerenciar o Canal AMMOC',
      );
    }
  }

  async get(): Promise<{
    wabaId: string;
    accessToken: string;
    verifyToken: string;
    appSecret: string;
    numbers: unknown[];
  }> {
    const { data: cfg } = await this.supabase
      .from('canal_config')
      .select('*')
      .limit(1)
      .single();
    const { data: numbers } = await this.supabase
      .from('canal_numbers')
      .select('*')
      .order('created_at');
    const c = cfg as {
      waba_id: string;
      access_token: string;
      verify_token: string;
      app_secret: string;
    } | null;
    return {
      wabaId: c?.waba_id ?? '',
      accessToken: mask(c?.access_token ?? ''), // mascarado — nunca retorna o token cru
      verifyToken: c?.verify_token ?? '',
      appSecret: mask(c?.app_secret ?? ''),
      numbers: numbers ?? [],
    };
  }

  async save(dto: SaveConfigDto): Promise<void> {
    const { data: existing } = await this.supabase
      .from('canal_config')
      .select('id')
      .limit(1)
      .single();
    // Só atualiza campos enviados (não sobrescreve segredo com vazio/mascarado).
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (dto.wabaId !== undefined) patch['waba_id'] = dto.wabaId;
    if (dto.verifyToken !== undefined) patch['verify_token'] = dto.verifyToken;
    if (dto.accessToken && !dto.accessToken.startsWith('••••'))
      patch['access_token'] = dto.accessToken;
    if (dto.appSecret && !dto.appSecret.startsWith('••••'))
      patch['app_secret'] = dto.appSecret;
    if (existing)
      await this.supabase
        .from('canal_config')
        .update(patch)
        .eq('id', (existing as { id: string }).id);
    else await this.supabase.from('canal_config').insert(patch);
  }

  async addNumber(
    phoneNumberId: string,
    displayNumber: string,
    label: string,
  ): Promise<void> {
    await this.supabase.from('canal_numbers').upsert(
      { phone_number_id: phoneNumberId, display_number: displayNumber, label },
      { onConflict: 'phone_number_id', ignoreDuplicates: false },
    );
  }

  async removeNumber(id: string): Promise<void> {
    await this.supabase.from('canal_numbers').delete().eq('id', id);
  }
}
