import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { CatalogMatchingService } from '../inventory/catalog-matching.service';
import { InventoryImportService } from '../inventory/inventory-import.service';
import { ImportBatchService } from '../inventory/import-batch.service';

export interface PreviewRow {
  rowNumber: number;
  productName: string;
  quantity: number;
  matchedName?: string;
  matchScore?: number;
  matchReason?: string;
  status: 'auto_matched' | 'needs_review' | 'unmatched';
}

export interface MigrationPreview {
  total: number;
  autoMatched: number;
  needsReview: number;
  unmatched: number;
  preview: PreviewRow[];        // first 50 rows with match results
  csvBuffer: Buffer;            // ready to pass to ingestCsv
  fileName: string;
  recognizedColumns: string[];  // header-text → mapped field (e.g. "productName (اسم المنتج)")
  ignoredColumns: string[];     // header text we couldn't map — surfaced to user to prevent silent drops
}

// Column header variants (EN + AR)
const COL_ALIASES: Record<string, string[]> = {
  productName:  ['productname', 'product name', 'name', 'item name', 'اسم المنتج', 'المنتج', 'الصنف'],
  quantity:     ['quantity', 'qty', 'stock', 'الكمية', 'المخزون', 'عدد'],
  category:     ['category', 'type', 'الفئة', 'النوع', 'التصنيف'],
  unit:         ['unit', 'uom', 'الوحدة', 'وحدة القياس'],
  barcode:      ['barcode', 'ean', 'upc', 'code', 'باركود', 'الكود'],
  manufacturer: ['manufacturer', 'brand', 'company', 'الشركة', 'المصنع', 'الماركة'],
  strength:     ['strength', 'dose', 'concentration', 'التركيز', 'الجرعة'],
  minThreshold: ['minthreshold', 'min threshold', 'min stock', 'reorder', 'الحد الأدنى'],
  expiryDate:   ['expirydate', 'expiry', 'expiry date', 'exp date', 'تاريخ الانتهاء', 'الانتهاء'],
  nameAr:       ['namear', 'arabic name', 'الاسم بالعربي', 'الاسم العربي'],
  genericName:  ['genericname', 'generic', 'الاسم العلمي', 'المادة الفعالة'],
};

function detectField(header: string): string | null {
  const h = header.toLowerCase().replace(/[\s_-]/g, '');
  for (const [field, aliases] of Object.entries(COL_ALIASES)) {
    if (aliases.some(a => a.replace(/[\s_-]/g, '') === h)) return field;
  }
  return null;
}

@Injectable()
export class MigrationAssistantService {
  private readonly logger = new Logger(MigrationAssistantService.name);

  constructor(
    private readonly matching: CatalogMatchingService,
    private readonly importSvc: InventoryImportService,
    private readonly batchSvc: ImportBatchService,
  ) {}

  // ─── STEP 1: Parse Excel + preview matching ───────────────────────────────

  async previewExcel(
    file: { buffer: Buffer; originalname: string },
  ): Promise<MigrationPreview> {
    const wb = new ExcelJS.Workbook();
    try {
      // exceljs type mismatch with newer Node Buffer generic — safe cast
      await wb.xlsx.load(file.buffer as any);
    } catch {
      throw new BadRequestException('تعذّر قراءة الملف — يرجى رفع ملف Excel صحيح (.xlsx)');
    }

    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('الملف لا يحتوي على بيانات');

    // Detect column mapping from header row
    const headerRow = ws.getRow(1);
    const colMap: Record<string, number> = {};
    const recognizedColumns: string[] = [];
    const ignoredColumns: string[] = [];
    headerRow.eachCell((cell, colNumber) => {
      const raw = String(cell.value ?? '').trim();
      if (!raw) return;
      const field = detectField(raw);
      if (field) {
        colMap[field] = colNumber;
        recognizedColumns.push(`${raw} → ${field}`);
      } else {
        ignoredColumns.push(raw);
      }
    });

    if (!colMap.productName) {
      throw new BadRequestException(
        'لم يتم العثور على عمود اسم المنتج — تأكد من وجود عمود "productName" أو "اسم المنتج"',
      );
    }

    // Parse all rows
    const rows: Array<Record<string, string>> = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return; // skip header
      const parsed: Record<string, string> = {};
      for (const [field, col] of Object.entries(colMap)) {
        const cell = row.getCell(col);
        parsed[field] = cell.value != null ? String(cell.value).trim() : '';
      }
      if (parsed.productName) rows.push(parsed);
    });

    if (!rows.length) throw new BadRequestException('الملف لا يحتوي على صفوف بيانات');

    // Run matching preview on first 50 rows
    const previewRows: PreviewRow[] = [];
    let autoMatched = 0;
    let needsReview = 0;
    let unmatched = 0;
    const PREVIEW_LIMIT = 50;

    for (let i = 0; i < Math.min(rows.length, PREVIEW_LIMIT); i++) {
      const r = rows[i];
      const rowNumber = i + 2;
      const qty = parseInt(r.quantity || '0', 10) || 0;

      const candidates = await this.matching.findCandidates(
        { name: r.productName, nameAr: r.nameAr, barcode: r.barcode, manufacturer: r.manufacturer, strength: r.strength },
        1,
      );
      const top = candidates[0];

      let status: PreviewRow['status'];
      if (top && top.score >= 85) {
        status = 'auto_matched';
        autoMatched++;
      } else if (top && top.score >= 55) {
        status = 'needs_review';
        needsReview++;
      } else {
        status = 'unmatched';
        unmatched++;
      }

      previewRows.push({
        rowNumber,
        productName:  r.productName,
        quantity:     qty,
        matchedName:  top?.product.name,
        matchScore:   top ? Math.round(top.score) : undefined,
        matchReason:  top?.reasons[0],
        status,
      });
    }

    // Count full totals for non-preview rows
    for (let i = PREVIEW_LIMIT; i < rows.length; i++) {
      const r = rows[i];
      const candidates = await this.matching.findCandidates({ name: r.productName }, 1);
      const top = candidates[0];
      if (top && top.score >= 85)      autoMatched++;
      else if (top && top.score >= 55) needsReview++;
      else                             unmatched++;
    }

    // Build CSV buffer for the existing ingestCsv path
    const csvLines = [
      'productName,genericName,category,unit,quantity,minThreshold,barcode,manufacturer,strength,dosageForm,nameAr,expiryDate',
    ];
    for (const r of rows) {
      const cols = [
        r.productName, r.genericName ?? '', r.category ?? 'general', r.unit ?? 'unit',
        r.quantity ?? '0', r.minThreshold ?? '', r.barcode ?? '',
        r.manufacturer ?? '', r.strength ?? '', r.dosageForm ?? '',
        r.nameAr ?? '', r.expiryDate ?? '',
      ];
      csvLines.push(cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','));
    }
    const csvBuffer = Buffer.from(csvLines.join('\n'), 'utf8');

    return {
      total: rows.length,
      autoMatched,
      needsReview,
      unmatched,
      preview: previewRows,
      csvBuffer,
      fileName: file.originalname,
      recognizedColumns,
      ignoredColumns,
    };
  }

  // ─── STEP 2: Kick off async import ───────────────────────────────────────

  async startImport(
    tenantId: string,
    userId: string,
    csvBuffer: Buffer,
    fileName: string,
  ): Promise<{ batchId: string; total: number }> {
    return this.importSvc.ingestCsv(tenantId, userId, {
      buffer: csvBuffer,
      originalname: fileName.replace(/\.xlsx?$/i, '.csv'),
    });
  }

  // ─── STEP 3: Poll batch progress ─────────────────────────────────────────

  async getBatchStatus(tenantId: string, batchId: string) {
    return this.batchSvc.getForTenant(tenantId, batchId);
  }
}
