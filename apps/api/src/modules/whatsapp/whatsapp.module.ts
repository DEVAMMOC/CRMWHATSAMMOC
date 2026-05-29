// apps/api/src/modules/whatsapp/whatsapp.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { AuthModule } from '../auth/auth.module';
import { EvolutionService } from './evolution.service';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { ContextService } from './context.service';
import { ConversationShareController } from './conversation-share.controller';

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
      provide: WebhookService,
      inject: ['SUPABASE_CLIENT'],
      useFactory: (supabase: ReturnType<typeof createClient>) =>
        new WebhookService(supabase),
    },
    {
      provide: ContextService,
      inject: ['SUPABASE_CLIENT'],
      useFactory: (supabase: ReturnType<typeof createClient>) =>
        new ContextService(supabase),
    },
    {
      provide: WhatsAppService,
      inject: [EvolutionService, 'SUPABASE_CLIENT', ConfigService],
      useFactory: (
        evo: EvolutionService,
        supabase: ReturnType<typeof createClient>,
        config: ConfigService,
      ) => new WhatsAppService(evo, supabase, config.get<string>('apiPublicUrl') ?? ''),
    },
  ],
  controllers: [WhatsAppController, WebhookController, ConversationShareController],
})
export class WhatsAppModule {}
