import { Module } from '@nestjs/common';
import { SupabaseAdminService } from './supabase-admin.service';
import { AuthGuard } from './auth.guard';

@Module({
  providers: [SupabaseAdminService, AuthGuard],
  exports: [SupabaseAdminService, AuthGuard],
})
export class AuthModule {}
