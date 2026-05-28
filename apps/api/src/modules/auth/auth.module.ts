import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseAdminService } from './supabase-admin.service';
import { AuthGuard } from './auth.guard';

@Module({
  imports: [ConfigModule],
  providers: [SupabaseAdminService, AuthGuard],
  exports: [SupabaseAdminService, AuthGuard],
})
export class AuthModule {}
