// apps/api/src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  const logger = new Logger('Bootstrap');

  // Evolution Go webhook payloads can be ~200KB (contact photos + message data)
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  app.setGlobalPrefix('api');

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  const config = app.get(ConfigService);
  const port = config.get<number>('port') ?? 3001;
  const frontendUrl = config.get<string>('frontendUrl') ?? 'http://localhost:3000';

  // Accept both configured domain and common dev/transition origins
  const allowedOrigins = [
    frontendUrl,
    'http://localhost:3000',
    'http://crm.ammoc.org.br',
    // sslip.io fallback during DNS transition
    /^http:\/\/[a-z0-9]+\.2\.25\.139\.166\.sslip\.io$/,
  ].filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  await app.listen(port);
  logger.log(`API running on http://localhost:${port}/api`);
}

bootstrap().catch((err) => {
  console.error('[Bootstrap] Fatal error during startup:', err);
  process.exit(1);
});
