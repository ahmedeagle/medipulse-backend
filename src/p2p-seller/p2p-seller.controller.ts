import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as path from 'path';
import * as fs from 'fs';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { SellerProfileService } from './seller-profile.service';
import { ExpiryProtectionService } from './expiry-protection.service';
import { ExpiryNotificationCron } from './expiry-notification.cron';
import { UpsertSellerProfileDto, RejectSellerDto } from './dto/upsert-seller-profile.dto';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';

@ApiTags('P2P Seller')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class P2pSellerController {
  private readonly logger = new Logger(P2pSellerController.name);

  constructor(
    private readonly profileService: SellerProfileService,
    private readonly expiryProtectionService: ExpiryProtectionService,
    private readonly expiryNotificationCron: ExpiryNotificationCron,
  ) {}

  // ── Pharmacy: manage own profile ─────────────────────────────────────────

  @Put('p2p/seller/profile')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Create or update seller profile' })
  upsertProfile(
    @CurrentUser() user: { tenantId: string },
    @Body() dto: UpsertSellerProfileDto,
  ) {
    return this.profileService.upsert(user.tenantId, dto);
  }

  @Get('p2p/seller/profile')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Get own seller profile' })
  getOwnProfile(@CurrentUser() user: { tenantId: string }) {
    return this.profileService.getOwn(user.tenantId);
  }

  @Post('p2p/seller/profile/legal-ack')
  @Roles(Role.PHARMACY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Record legal compliance acknowledgement' })
  async legalAck(@CurrentUser() user: { tenantId: string }) {
    await this.profileService.recordLegalAck(user.tenantId);
  }

  @Delete('p2p/seller/profile/legal-ack')
  @Roles(Role.PHARMACY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reset legal ack timestamp (re-triggers declaration modal)' })
  async resetLegalAck(@CurrentUser() user: { tenantId: string }) {
    await this.profileService.resetLegalAck(user.tenantId);
  }

  private static readonly ALLOWED_DOC_TYPES = new Set([
    'pharmacy_license', 'commercial_reg', 'tax_doc',
    'pharmacist_license', 'license_holder_id', 'municipal_permit', 'vat_cert',
  ]);

  private static readonly ALLOWED_MIMES = new Set([
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
  ]);

  private static readonly MIME_TO_EXT: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png':  '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
  };

  @Post('p2p/seller/docs/:docType')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Upload a compliance document for the seller profile' })
  // Memory storage: file lands in file.buffer AFTER guards run — no diskStorage callback race
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadDoc(
    @CurrentUser() user: { tenantId: string },
    @Param('docType') docType: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!P2pSellerController.ALLOWED_DOC_TYPES.has(docType)) {
      throw new BadRequestException(`Invalid document type: ${docType}`);
    }
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    // MIME-type gate (safer than extension check — browsers set this correctly)
    if (!P2pSellerController.ALLOWED_MIMES.has(file.mimetype)) {
      throw new BadRequestException('Only PDF, JPG, PNG, or WEBP files are allowed');
    }

    const ext = P2pSellerController.MIME_TO_EXT[file.mimetype] ?? '.bin';
    const filename = `${user.tenantId}-${docType}${ext}`;
    const uploadDir = path.join(process.cwd(), 'uploads', 'seller-docs');

    try {
      await fs.promises.mkdir(uploadDir, { recursive: true });
      await fs.promises.writeFile(path.join(uploadDir, filename), file.buffer);
    } catch (err) {
      this.logger.error(`Failed to write uploaded file: ${err?.message}`, err?.stack);
      throw new InternalServerErrorException('Could not save file to disk');
    }

    try {
      const fileUrl = `/uploads/seller-docs/${filename}`;
      return await this.profileService.saveDocUrl(user.tenantId, docType, fileUrl);
    } catch (err) {
      // Clean up the written file if DB save fails so disk and DB stay in sync
      await fs.promises.unlink(path.join(uploadDir, filename)).catch(() => undefined);
      this.logger.error(`saveDocUrl failed for ${docType}: ${err?.message}`, err?.stack);
      throw new InternalServerErrorException(`Could not save document record: ${err?.message}`);
    }
  }

  @Get('p2p/seller/stats')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Get seller revenue and order stats (single SQL aggregate)' })
  getSellerStats(@CurrentUser() user: { tenantId: string }) {
    return this.profileService.getSellerStats(user.tenantId);
  }

  @Get('p2p/seller/expiry-alerts')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Get expiry alerts for own inventory (180-day horizon)' })
  getExpiryAlerts(@CurrentUser() user: { tenantId: string }) {
    return this.expiryProtectionService.getAlertsForSeller(user.tenantId);
  }

  @Post('p2p/seller/expiry-notifications/trigger')
  @Roles(Role.SYSTEM_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger expiry notification digest (system admin only — runs for all tenants)' })
  async triggerExpiryNotifications() {
    await this.expiryNotificationCron.sendDailyExpiryDigests();
    await this.expiryNotificationCron.sendCriticalItemAlerts();
    return { ok: true };
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  @Get('p2p/admin/sellers')
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'List all seller profiles (admin)' })
  listSellers(
    @Query('status') status?: string,
    @Query() pagination?: PaginationQueryDto,
  ) {
    return this.profileService.listAll(status, pagination);
  }

  @Patch('p2p/admin/sellers/:tenantId/verify')
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'Verify a seller profile (admin)' })
  verify(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.profileService.verify(tenantId);
  }

  @Patch('p2p/admin/sellers/:tenantId/reject')
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'Reject a seller profile (admin)' })
  reject(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: RejectSellerDto,
  ) {
    return this.profileService.reject(tenantId, dto.reason);
  }
}
