import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAdminService } from '../auth/supabase-admin.service';
import { EvolutionService } from '../whatsapp/evolution.service';
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
  private readonly logger = new Logger(UsersService.name);
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly evolution: EvolutionService,
  ) {}

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

  async deleteUser(callerId: string, targetId: string): Promise<void> {
    const { data: caller, error: callerErr } = await this.supabase
      .from('users')
      .select('role')
      .eq('id', callerId)
      .single();
    // Surface infra errors (não confundir falha de DB com "não é admin").
    if (callerErr && callerErr.code !== 'PGRST116') throw new Error(callerErr.message);
    if (!caller || (caller as { role: string }).role !== 'admin') {
      throw new ForbiddenException(
        'Apenas administradores podem excluir usuários',
      );
    }
    if (callerId === targetId) {
      throw new BadRequestException('Você não pode excluir a si mesmo');
    }
    const { data: target, error: targetErr } = await this.supabase
      .from('users')
      .select('role, evolution_instance_id')
      .eq('id', targetId)
      .single();
    if (targetErr && targetErr.code !== 'PGRST116') throw new Error(targetErr.message);
    if (!target) throw new NotFoundException('Usuário não encontrado');
    const t = target as { role: string; evolution_instance_id: string | null };

    if (t.role === 'admin') {
      // Nota: a checagem (count seguido de delete) não é atômica — em uma
      // exclusão concorrente de dois admins há um TOCTOU teórico. Aceitável
      // para a escala desta org (poucos admins); fix mais forte seria no DB.
      const { count } = await this.supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin');
      if ((count ?? 0) <= 1) {
        throw new BadRequestException(
          'Não é possível excluir o último administrador',
        );
      }
    }

    if (t.evolution_instance_id) {
      try {
        await this.evolution.deleteInstance(t.evolution_instance_id);
      } catch (e) {
        this.logger.warn(
          `Falha ao excluir instância Evolution: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    // Ordem: remove do auth ANTES de public.users. Não há FK/trigger ligando as
    // duas tabelas, então em falha parcial é melhor sobrar uma linha public sem
    // identidade (não consegue logar e re-executar converge) do que um usuário
    // que ainda autentica sem perfil. `deleteAuthUser` é idempotente (tolera
    // "not found"), então re-rodar a exclusão sempre converge.
    await this.supabaseAdmin.deleteAuthUser(targetId);

    const { error: delErr } = await this.supabase
      .from('users')
      .delete()
      .eq('id', targetId);
    if (delErr) throw new Error(delErr.message);

    this.logger.log(`Usuário ${targetId} excluído por ${callerId}`);
  }
}
