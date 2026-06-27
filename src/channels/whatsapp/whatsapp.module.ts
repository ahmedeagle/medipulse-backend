import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WhatsappMessage } from './entities/whatsapp-message.entity';
import { Approval }        from '../../ai-governance/entities/approval.entity';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';

/**
 * WhatsApp channel module — safe to mount when WHATSAPP_ENABLED is false.
 *
 * Note: raw body capture for HMAC verification is provided globally by
 * `main.ts` via NestExpressApplication's `bodyParser` raw option (already
 * set for other webhooks). The controller reads `req.rawBody`.
 */
@Module({
  imports:   [TypeOrmModule.forFeature([WhatsappMessage, Approval])],
  providers: [WhatsappService],
  controllers: [WhatsappController],
  exports:   [WhatsappService],
})
export class WhatsappModule {}
