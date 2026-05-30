import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { AuthModule } from '../auth/auth.module';
import { SectorsService } from './sectors.service';
import { SectorsController } from './sectors.controller';

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
      provide: SectorsService,
      inject: ['SUPABASE_CLIENT'],
      useFactory: (supabase: ReturnType<typeof createClient>) =>
        new SectorsService(supabase),
    },
  ],
  controllers: [SectorsController],
  exports: [SectorsService],
})
export class SectorsModule {}
