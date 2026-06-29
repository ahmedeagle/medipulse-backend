import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalesHistoryUpload } from './entities/sales-history-upload.entity';
import { NotificationService } from '../notifications/notification.service';

export interface IncomingFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class SalesHistoryService {
  private readonly logger = new Logger(SalesHistoryService.name);

  constructor(
    @InjectRepository(SalesHistoryUpload)
    private readonly repo: Repository<SalesHistoryUpload>,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Persist one or more uploaded history files for later ops processing and
   * raise a single tenant-wide notification so ops knows to pick them up.
   */
  async saveUploads(
    tenantId: string,
    userId: string | null,
    files: IncomingFile[],
    kind = 'unspecified',
    note: string | null = null,
  ): Promise<{ uploaded: number; ids: string[] }> {
    const rows = files.map((f) =>
      this.repo.create({
        tenantId,
        uploadedByUserId: userId,
        fileName: f.originalname,
        fileSize: f.size,
        mimeType: f.mimetype,
        fileContent: f.buffer,
        kind,
        note,
        status: 'pending',
      }),
    );

    const saved = await this.repo.save(rows);

    await this.notifications.create({
      tenantId,
      userId: undefined, // tenant-wide / ops
      type: 'sales_history_upload_received',
      title: 'تم استلام ملفات سجل المبيعات',
      body: `رفعت الصيدلية ${saved.length} ملف لسجل المبيعات/المشتريات بانتظار المعالجة من فريق العمليات لتفعيل التنبؤ.`,
      resourceRef: `salesUpload:${saved[0].id}`,
      dedupeWindowMs: 60 * 60_000, // 1h — avoid spamming ops on multi-file uploads
    });

    this.logger.log(
      `Stored ${saved.length} sales-history file(s) for tenant ${tenantId} (kind=${kind})`,
    );

    return { uploaded: saved.length, ids: saved.map((r) => r.id) };
  }

  /** List a tenant's uploads (metadata only — never returns file bytes). */
  async listForTenant(tenantId: string): Promise<Array<Omit<SalesHistoryUpload, 'fileContent'>>> {
    const rows = await this.repo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      select: ['id', 'fileName', 'fileSize', 'mimeType', 'kind', 'note', 'status', 'createdAt'],
      take: 50,
    });
    return rows as Array<Omit<SalesHistoryUpload, 'fileContent'>>;
  }
}
