import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import type {
  Sector,
  SectorMemberUser,
  SectorMemberWithLead,
  SectorWithMembers,
} from '@crmwhats/types';

// Explicit, public-safe column list for embedded sector members. Never use
// users(*) here: that would leak secrets such as evolution_instance_token to
// any authenticated client via GET /sectors and GET /sectors/:id.
const MEMBER_COLUMNS =
  'id, email, name, role, whatsapp_number, whatsapp_status, is_online, avatar_url, created_at';
import type { CreateSectorDto } from './dto/create-sector.dto';
import type { UpdateSectorDto } from './dto/update-sector.dto';

@Injectable()
export class SectorsService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Authorization for sector management. The role lives in the `users` table
   * (AppUser.role) in this codebase — not in Supabase auth metadata — so we
   * read it from there, consistent with how UsersService loads the app user.
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
        'Apenas admin ou supervisor podem gerenciar setores',
      );
    }
  }

  async findAll(): Promise<SectorWithMembers[]> {
    const { data: sectors, error } = await this.supabase
      .from('sectors')
      .select('*')
      .order('name');
    if (error) throw new Error(error.message);

    const list = (sectors ?? []) as Sector[];
    const sectorIds = list.map((s) => s.id);
    if (sectorIds.length === 0) return [];

    const { data: memberships, error: memberError } = await this.supabase
      .from('sector_members')
      .select(`sector_id, lead, users(${MEMBER_COLUMNS})`)
      .in('sector_id', sectorIds);
    if (memberError) throw new Error(memberError.message);

    const memberMap = new Map<string, SectorMemberWithLead[]>();
    for (const m of (memberships ?? []) as Array<{
      sector_id: string;
      lead: boolean;
      users: unknown;
    }>) {
      const arr = memberMap.get(m.sector_id) ?? [];
      if (m.users) arr.push({ ...(m.users as SectorMemberUser), lead: m.lead });
      memberMap.set(m.sector_id, arr);
    }

    return list.map((s) => ({ ...s, members: memberMap.get(s.id) ?? [] }));
  }

  async findOne(id: string): Promise<SectorWithMembers> {
    const { data, error } = await this.supabase
      .from('sectors')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) throw new NotFoundException('Setor não encontrado');

    const { data: memberships, error: memberError } = await this.supabase
      .from('sector_members')
      .select(`lead, users(${MEMBER_COLUMNS})`)
      .eq('sector_id', id);
    if (memberError) throw new Error(memberError.message);

    const members = ((memberships ?? []) as Array<{ lead: boolean; users: unknown }>)
      .filter((m) => Boolean(m.users))
      .map((m) => ({ ...(m.users as SectorMemberUser), lead: m.lead }));

    return { ...(data as Sector), members };
  }

  async create(dto: CreateSectorDto): Promise<Sector> {
    const { data, error } = await this.supabase
      .from('sectors')
      .insert({
        name: dto.name,
        description: dto.description ?? null,
        keywords: dto.keywords ?? [],
        color: dto.color ?? '#128C7E',
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as Sector;
  }

  async update(id: string, dto: UpdateSectorDto): Promise<Sector> {
    const { data, error } = await this.supabase
      .from('sectors')
      .update(dto)
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new NotFoundException('Setor não encontrado');
    return data as Sector;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('sectors')
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async addMember(sectorId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('sector_members')
      .upsert(
        { sector_id: sectorId, user_id: userId },
        { ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
  }

  async removeMember(sectorId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('sector_members')
      .delete()
      .eq('sector_id', sectorId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }

  /** Define/remove um membro como Chefe do setor (lead). */
  async setMemberLead(
    sectorId: string,
    userId: string,
    lead: boolean,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('sector_members')
      .update({ lead })
      .eq('sector_id', sectorId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }
}
