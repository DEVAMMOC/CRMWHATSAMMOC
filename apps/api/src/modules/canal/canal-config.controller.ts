import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CanalConfigService } from './canal-config.service';
import { MetaService } from './meta.service';
import { SaveConfigDto } from './dto/save-config.dto';
import { AddNumberDto } from './dto/add-number.dto';

@Controller('canal')
@UseGuards(AuthGuard)
export class CanalConfigController {
  constructor(
    private readonly config: CanalConfigService,
    private readonly meta: MetaService,
  ) {}

  @Get('config')
  get() {
    return this.config.get();
  }

  @Put('config')
  async save(@CurrentUser() user: User, @Body() dto: SaveConfigDto) {
    await this.config.assertCanManage(user.id);
    return this.config.save(dto);
  }

  @Post('numbers')
  async add(@CurrentUser() user: User, @Body() dto: AddNumberDto) {
    await this.config.assertCanManage(user.id);
    return this.config.addNumber(
      dto.phoneNumberId,
      dto.displayNumber,
      dto.label ?? '',
    );
  }

  @Delete('numbers/:id')
  async remove(@CurrentUser() user: User, @Param('id') id: string) {
    await this.config.assertCanManage(user.id);
    return this.config.removeNumber(id);
  }

  @Post('test-connection')
  async test(
    @CurrentUser() user: User,
    @Body() body: { phoneNumberId: string },
  ) {
    await this.config.assertCanManage(user.id);
    return this.meta.testConnection(body.phoneNumberId);
  }
}
