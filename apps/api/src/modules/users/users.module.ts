import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { AuthModule } from '../auth/auth.module';
import { SupabaseAdminService } from '../auth/supabase-admin.service';
import { EvolutionService } from '../whatsapp/evolution.service';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [AuthModule],
  providers: [
    EvolutionService,
    {
      provide: 'SUPABASE_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createClient(
          config.getOrThrow<string>('supabase.url'),
          config.getOrThrow<string>('supabase.serviceRoleKey'),
        ),
    },
    {
      provide: UsersService,
      inject: ['SUPABASE_CLIENT', SupabaseAdminService, EvolutionService],
      useFactory: (
        supabase: ReturnType<typeof createClient>,
        admin: SupabaseAdminService,
        evo: EvolutionService,
      ) => new UsersService(supabase, admin, evo),
    },
  ],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
