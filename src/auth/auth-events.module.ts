import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthEventsController } from './auth-events.controller';
import { KeycloakEventsService } from './keycloak-events.service';
import { KeycloakAuthEvent } from '../audit/entities/keycloak-auth-event.entity';
import { RedisModule } from '../common/redis/redis.module';

/**
 * Imported by both AppModule (HTTP trigger endpoint) and WorkerAppModule (cron job).
 * The @Cron decorator on KeycloakEventsService activates in whichever process runs this module.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([KeycloakAuthEvent], 'audit'),
    RedisModule,
  ],
  controllers: [AuthEventsController],
  providers: [KeycloakEventsService],
  exports: [KeycloakEventsService],
})
export class AuthEventsModule {}
