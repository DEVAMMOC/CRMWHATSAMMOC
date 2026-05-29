// apps/api/src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  const config = app.get(ConfigService);
  const port = config.get<number>('port') ?? 3001;
  const frontendUrl = config.get<string>('frontendUrl') ?? 'http://localhost:3000';

  app.enableCors({
    origin: frontendUrl,
    credentials: true,
  });

  await app.listen(port);
  logger.log(`API running on http://localhost:${port}/api`);
}

bootstrap().catch((err) => {
  console.error('[Bootstrap] Fatal error during startup:', err);
  process.exit(1);
});
