import {
  Controller,
  Post,
  Get,
  Body,
  UploadedFiles,
  UseInterceptors,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { SalesHistoryService } from './sales-history.service';

@ApiTags('sales-history')
@ApiBearerAuth('access-token')
@Controller('pharmacy/sales-history')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesHistoryController {
  constructor(private readonly svc: SalesHistoryService) {}

  @Post('upload')
  @Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload historical sales/purchase files for ops to process',
    description:
      'Stores up to 10 Excel/CSV files (≤15MB each) of the pharmacy\'s past ' +
      'sales/purchase history. Files are NOT parsed here — the ops team processes ' +
      'them to backfill consumption history and unlock forecasting from day one.',
  })
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB per file
      fileFilter: (_req, file, cb) => {
        if (
          file.mimetype.includes('spreadsheet') ||
          file.mimetype.includes('csv') ||
          file.mimetype === 'application/vnd.ms-excel' ||
          file.originalname.match(/\.(xlsx?|csv)$/i)
        ) {
          cb(null, true);
        } else {
          cb(new BadRequestException('يجب أن تكون الملفات بصيغة Excel أو CSV'), false);
        }
      },
    }),
  )
  async upload(
    @CurrentUser() user: any,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('kind') kind?: string,
    @Body('note') note?: string,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('لم يتم رفع أي ملف');
    }
    const allowedKinds = ['sales', 'purchases', 'mixed', 'unspecified'];
    const safeKind = allowedKinds.includes(kind ?? '') ? kind! : 'unspecified';

    return this.svc.saveUploads(
      user.tenantId,
      user.sub ?? user.userId ?? null,
      files.map((f) => ({
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
        buffer: f.buffer,
      })),
      safeKind,
      note?.trim() ? note.trim().slice(0, 1000) : null,
    );
  }

  @Get()
  @Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
  @ApiOperation({ summary: 'List this pharmacy\'s uploaded history files (metadata only)' })
  list(@CurrentUser() user: any) {
    return this.svc.listForTenant(user.tenantId);
  }
}
