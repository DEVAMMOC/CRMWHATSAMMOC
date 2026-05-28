import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { AuthModule } from '../auth/auth.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [AuthModule],
  providers: [
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
      inject: ['SUPABASE_CLIENT'],
      useFactory: (supabase: ReturnType<typeof createClient>) =>
        new UsersService(supabase),
    },
  ],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
