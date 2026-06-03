import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { AuthModule } from '../auth/auth.module';
import { MetaService } from './meta.service';
import { CanalConfigService } from './canal-config.service';
import { CanalConversationService } from './canal-conversation.service';
import { CanalSchedulerService } from './canal-scheduler.service';
import { CanalWebhookController } from './canal-webhook.controller';
import { CanalConfigController } from './canal-config.controller';
import { CanalInboxController } from './canal-inbox.controller';

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
      provide: MetaService,
      inject: ['SUPABASE_CLIENT'],
      useFactory: (supabase: ReturnType<typeof createClient>) =>
        new MetaService(supabase),
    },
    {
      provide: CanalConfigService,
      inject: ['SUPABASE_CLIENT'],
      useFactory: (supabase: ReturnType<typeof createClient>) =>
        new CanalConfigService(supabase),
    },
    {
      provide: CanalConversationService,
      inject: ['SUPABASE_CLIENT', MetaService],
      useFactory: (
        supabase: ReturnType<typeof createClient>,
        meta: MetaService,
      ) => new CanalConversationService(supabase, meta),
    },
    {
      provide: CanalSchedulerService,
      inject: ['SUPABASE_CLIENT'],
      useFactory: (supabase: ReturnType<typeof createClient>) =>
        new CanalSchedulerService(supabase),
    },
  ],
  controllers: [
    CanalWebhookController,
    CanalConfigController,
    CanalInboxController,
  ],
})
export class CanalModule {}
