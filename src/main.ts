import './telemetry'; // must be first — boots OTel before NestJS
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import helmet from 'helmet';
import * as express from 'express';
import * as path from 'path';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter as BullBoardExpressAdapter } from '@bull-board/express';
import { AppModule } from './app.module';
import { AI_RECOMMENDATIONS_QUEUE } from './ai/ai.constants';
import { AUDIT_QUEUE } from './audit/audit.constants';
import { WEBHOOK_DELIVERY_QUEUE } from './webhooks/webhook.constants';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const isProd = process.env.NODE_ENV === 'production';

  // Fail fast in production if required env vars are missing
  if (isProd && !process.env.FRONTEND_URL) {
    throw new Error('FRONTEND_URL must be set in production');
  }

  // ── Security headers ───────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: isProd ? ["'self'"] : ["'self'", "'unsafe-eval'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // ── CORS ───────────────────────────────────────────────────────────────────
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // ── Static files — uploaded seller documents + product images ──────────
  // 7-day browser cache (product images change rarely; uploads are
  // content-addressed). ETag stays on so a forced refresh still revalidates.
  app.useStaticAssets(path.join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    immutable: false,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    },
  });

  // ── Body size limit ────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ── Validation ─────────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // ── Global prefix ──────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ── Bull Board — queue monitoring UI (development only) ───────────────────
  if (!isProd) {
    const boardAdapter = new BullBoardExpressAdapter();
    boardAdapter.setBasePath('/admin/queues');

    createBullBoard({
      queues: [
        new BullMQAdapter(app.get<Queue>(getQueueToken(AI_RECOMMENDATIONS_QUEUE))),
        new BullMQAdapter(app.get<Queue>(getQueueToken(AUDIT_QUEUE))),
        new BullMQAdapter(app.get<Queue>(getQueueToken(WEBHOOK_DELIVERY_QUEUE))),
      ],
      serverAdapter: boardAdapter,
      options: { uiConfig: { boardTitle: 'MediPulse Queues' } },
    });

    const bullBoardApiKey = process.env.BULL_BOARD_API_KEY;

    app.use(
      '/admin/queues',
      (req: any, res: any, next: any) => {
        const token = (req.headers['authorization'] ?? '').replace('Bearer ', '').trim();
        if (!bullBoardApiKey || token !== bullBoardApiKey) {
          res.status(401).json({ message: 'Unauthorized' });
          return;
        }
        next();
      },
      boardAdapter.getRouter(),
    );
  }

  // ── Swagger — dev only ─────────────────────────────────────────────────────
  if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle('MediPulse API')
      .setDescription('AI-powered pharmacy management SaaS — development only')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
    console.log(`Swagger: http://localhost:${process.env.PORT || 3000}/docs`);
    console.log(`Bull Board: http://localhost:${process.env.PORT || 3000}/admin/queues  (requires BULL_BOARD_API_KEY header)`);
  }

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`MediPulse API running on :${port} [${process.env.NODE_ENV ?? 'development'}]`);
}

bootstrap();
