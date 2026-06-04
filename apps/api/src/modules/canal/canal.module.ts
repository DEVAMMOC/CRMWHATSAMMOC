import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { AuthModule } from '../auth/auth.module';
import { MetaService } from './meta.service';
import { CanalConfigService } from './canal-config.service';
import { CanalConversationService } from './canal-conversation.service';
import { CanalExportService } from './canal-export.service';
import { GithubSyncService } from './github-sync.service';
import { AiService } from '../../common/ai.service';
import { CanalClassifyService } from './canal-classify.service';
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
      provide: AiService,
      inject: ['SUPABASE_CLIENT'],
      useFactory: (supabase: ReturnType<typeof createClient>) =>
        new AiService(supabase),
    },
    {
      provide: CanalExportService,
      inject: ['SUPABASE_CLIENT', AiService],
      useFactory: (supabase: ReturnType<typeof createClient>, ai: AiService) =>
        new CanalExportService(supabase, ai),
    },
    {
      provide: CanalClassifyService,
      inject: ['SUPABASE_CLIENT', AiService, CanalConversationService],
      useFactory: (
        supabase: ReturnType<typeof createClient>,
        ai: AiService,
        convs: CanalConversationService,
      ) => new CanalClassifyService(supabase, ai, convs),
    },
    {
      provide: GithubSyncService,
      inject: ['SUPABASE_CLIENT'],
      useFactory: (supabase: ReturnType<typeof createClient>) =>
        new GithubSyncService(supabase),
    },
    {
      provide: CanalSchedulerService,
      inject: ['SUPABASE_CLIENT', CanalExportService, GithubSyncService],
      useFactory: (
        supabase: ReturnType<typeof createClient>,
        exportSvc: CanalExportService,
        githubSync: GithubSyncService,
      ) => new CanalSchedulerService(supabase, exportSvc, githubSync),
    },
  ],
  controllers: [
    CanalWebhookController,
    CanalConfigController,
    CanalInboxController,
  ],
})
export class CanalModule {}
