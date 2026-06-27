import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WhatsappService } from './whatsapp.service';

/**
 * BSP-agnostic webhook surface. Path layout deliberately matches Meta's
 * Cloud API conventions so the same URL can be used with 360dialog by
 * pointing their forwarder here.
 *
 * The body is read via the raw-body buffer attached to `req.rawBody` (set
 * up by a small middleware in WhatsappModule). HMAC verification MUST be
 * done over the raw bytes, never the parsed JSON.
 */
@ApiTags('whatsapp')
@Controller('channels/whatsapp')
export class WhatsappController {
  constructor(private readonly wa: WhatsappService) {}

  @Post('webhook/:tenantId')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Inbound WhatsApp webhook (BSP-agnostic)',
    description:
      'Verifies HMAC signature, persists message idempotently, and (when the payload references an approval) transitions that approval — never mutates plan data.',
  })
  async webhook(
    @Param('tenantId') tenantId: string,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: any,
  ) {
    if (!this.wa.isEnabled()) {
      // Always 200 to satisfy BSP delivery retries — but do nothing.
      return { ok: true, channel: 'disabled' };
    }

    const raw = req.rawBody?.toString('utf8') ?? JSON.stringify(body ?? {});
    if (!this.wa.verifySignature(raw, signature)) {
      throw new ForbiddenException('invalid_signature');
    }

    // Minimal BSP-agnostic extraction. Real adapter normalises per vendor;
    // here we just guard for the fields we need.
    const msg =
      body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ??
      body?.message ??
      null;
    if (!msg) {
      return { ok: true, ignored: true, reason: 'no_message' };
    }

    const providerMessageId: string = msg.id ?? msg.message_id ?? '';
    const phone: string = msg.from ?? msg.sender ?? '';
    const bodyText: string = msg.text?.body ?? msg.body ?? '';
    const approvalId: string | null = msg.context?.approval_id ?? null;

    if (!providerMessageId || !phone) {
      return { ok: true, ignored: true, reason: 'missing_fields' };
    }

    const stored = await this.wa.handleInbound({
      tenantId,
      providerMessageId,
      phone,
      bodyText,
      approvalId,
    });

    return { ok: true, status: stored?.status ?? 'unknown' };
  }
}
