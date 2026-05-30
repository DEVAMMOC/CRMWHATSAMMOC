// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SectorsModule } from './modules/sectors/sectors.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    AuthModule,
    UsersModule,
    SectorsModule,
    WhatsAppModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
