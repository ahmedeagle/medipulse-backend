import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WEBHOOK_DELIVERY_QUEUE } from './webhook.constants';

/**
 * Imported only by WorkerAppModule.
 * Contains the processor that delivers webhooks via HTTP POST.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookSubscription, WebhookDelivery]),
    BullModule.registerQueue({ name: WEBHOOK_DELIVERY_QUEUE }),
  ],
  providers: [WebhookDeliveryProcessor],
})
export class WebhooksWorkerModule {}
