import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WebhookDispatchListener } from './webhook-dispatch.listener';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WEBHOOK_DELIVERY_QUEUE } from './webhook.constants';

/**
 * Imported by the main HTTP app.
 * Registers the delivery queue (for enqueueing), the service, the listener, and the controller.
 * WebhookDeliveryProcessor lives in WebhooksWorkerModule (worker process only).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookSubscription, WebhookDelivery]),
    BullModule.registerQueue({ name: WEBHOOK_DELIVERY_QUEUE }),
  ],
  controllers: [WebhookController],
  providers: [WebhookService, WebhookDispatchListener],
  exports: [WebhookService],
})
export class WebhooksModule {}
