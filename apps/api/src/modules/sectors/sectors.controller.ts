import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SectorsService } from './sectors.service';
import { CreateSectorDto } from './dto/create-sector.dto';
import { UpdateSectorDto } from './dto/update-sector.dto';
import { AddMemberDto } from './dto/add-member.dto';

@Controller('sectors')
@UseGuards(AuthGuard)
export class SectorsController {
  constructor(private readonly sectors: SectorsService) {}

  @Get()
  findAll() {
    return this.sectors.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sectors.findOne(id);
  }

  @Post()
  async create(@CurrentUser() user: User, @Body() dto: CreateSectorDto) {
    await this.sectors.assertCanManage(user.id);
    return this.sectors.create(dto);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateSectorDto,
  ) {
    await this.sectors.assertCanManage(user.id);
    return this.sectors.update(id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: User, @Param('id') id: string) {
    await this.sectors.assertCanManage(user.id);
    return this.sectors.remove(id);
  }

  @Post(':id/members')
  async addMember(
    @CurrentUser() user: User,
    @Param('id') sectorId: string,
    @Body() dto: AddMemberDto,
  ) {
    await this.sectors.assertCanManage(user.id);
    return this.sectors.addMember(sectorId, dto.userId);
  }

  @Delete(':id/members/:userId')
  async removeMember(
    @CurrentUser() user: User,
    @Param('id') sectorId: string,
    @Param('userId') userId: string,
  ) {
    await this.sectors.assertCanManage(user.id);
    return this.sectors.removeMember(sectorId, userId);
  }
}
