import './telemetry'; // must be first
import { NestFactory } from '@nestjs/core';
import { WorkerAppModule } from './worker-app.module';

/**
 * Worker process entry point.
 *
 * This process:
 *   - Runs BullMQ consumers (AI recommendations + Audit events)
 *   - Exposes a minimal HTTP server on WORKER_PORT for liveness/readiness probes
 *   - Has zero overlap with the HTTP API (no CORS, no Swagger, no rate limiting)
 *
 * Scale independently from the API:
 *   docker-compose scale worker=3
 *   kubectl scale deployment medipulse-worker --replicas=3
 */
async function bootstrap() {
  const app = await NestFactory.create(WorkerAppModule, {
    // Suppress NestJS bootstrap noise; worker logs its own meaningful events
    logger: ['error', 'warn', 'log'],
  });

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();  // BullMQ workers drain in-flight jobs on SIGTERM

  const port = process.env.WORKER_PORT ?? 3001;
  await app.listen(port);
  console.log(
    `MediPulse Worker running on :${port} [${process.env.NODE_ENV ?? 'development'}]`,
  );
}

bootstrap();
