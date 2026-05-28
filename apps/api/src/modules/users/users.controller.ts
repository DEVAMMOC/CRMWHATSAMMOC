import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() authUser: User) {
    return this.usersService.findById(authUser.id);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() authUser: User,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(authUser.id, dto);
  }
}
