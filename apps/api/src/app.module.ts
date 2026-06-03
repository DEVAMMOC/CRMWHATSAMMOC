// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SectorsModule } from './modules/sectors/sectors.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { CanalModule } from './modules/canal/canal.module';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    SectorsModule,
    WhatsAppModule,
    CanalModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
