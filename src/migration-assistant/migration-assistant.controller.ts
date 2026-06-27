import {
  Controller,
  Post,
  Get,
  Param,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Req,
  BadRequestException,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { MigrationAssistantService } from './migration-assistant.service';

@Controller('migration')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MigrationAssistantController {
  constructor(private readonly svc: MigrationAssistantService) {}

  /**
   * Step 1 — Upload Excel, get a preview without saving anything.
   * Returns match stats + first-50-row preview + an opaque csvPayload
   * that the client sends back in /import.
   */
  @Post('preview')
  @Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
      fileFilter: (_req, file, cb) => {
        if (file.mimetype.includes('spreadsheet') || file.originalname.match(/\.xlsx?$/i)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('يجب أن يكون الملف بصيغة Excel (.xlsx)'), false);
        }
      },
    }),
  )
  async preview(
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('لم يتم رفع أي ملف');

    const result = await this.svc.previewExcel({
      buffer: file.buffer,
      originalname: file.originalname,
    });

    // Return everything except the binary csvBuffer — encode it as base64
    // so the client can echo it back in /import without another upload.
    return {
      total:        result.total,
      autoMatched:  result.autoMatched,
      needsReview:  result.needsReview,
      unmatched:    result.unmatched,
      preview:      result.preview,
      csvPayload:   result.csvBuffer.toString('base64'),
      fileName:     result.fileName,
      recognizedColumns: result.recognizedColumns,
      ignoredColumns:    result.ignoredColumns,
    };
  }

  /**
   * Step 2 — Confirm and kick off async import.
   * Client sends back the csvPayload from /preview.
   */
  @Post('import')
  @Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
  async import(
    @Req() req: any,
    @Body() body: { csvPayload: string; fileName: string },
  ) {
    if (!body.csvPayload) throw new BadRequestException('csvPayload مطلوب');

    const csvBuffer = Buffer.from(body.csvPayload, 'base64');
    const tenantId = req.user?.tenantId;
    const userId = req.user?.sub ?? req.user?.userId ?? null;

    return this.svc.startImport(tenantId, userId, csvBuffer, body.fileName || 'import.csv');
  }

  /**
   * Step 3 — Poll batch progress.
   */
  @Get('batch/:batchId')
  @Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
  async batchStatus(@Req() req: any, @Param('batchId') batchId: string) {
    const tenantId = req.user?.tenantId;
    return this.svc.getBatchStatus(tenantId, batchId);
  }
}
