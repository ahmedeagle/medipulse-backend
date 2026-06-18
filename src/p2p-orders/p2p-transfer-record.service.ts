import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface TransferRecordData {
  orderId: string;
  invoiceNumber: string | null;
  createdAt: Date;
  completedAt: Date | null;
  shippedAt: Date | null;
  expectedDeliveryAt: Date | null;
  deliveryNote: string | null;
  urgencyLevel: string;
  status: string;
  requestedQty: number;
  agreedPrice: number;
  sellerName: string;
  sellerLicense: string | null;
  sellerCity: string | null;
  buyerName: string;
  buyerLicense: string | null;
  buyerCity: string | null;
  productName: string | null;
  productNameAr: string | null;
  productBarcode: string | null;
  productStrength: string | null;
}

@Injectable()
export class P2pTransferRecordService {
  constructor(private readonly dataSource: DataSource) {}

  async getTransferRecord(tenantId: string, orderId: string): Promise<string> {
    const rows = await this.dataSource.query<any[]>(`
      SELECT
        o.id, o.status, o."requestedQty", o."agreedPrice",
        o."urgencyLevel", o."expectedDeliveryAt", o."shippedAt",
        o."deliveryNote", o."completedAt", o."createdAt",
        o."buyerTenantId", o."sellerTenantId",
        COALESCE(sp_s."legalName", t_s.name)      AS "sellerName",
        sp_s."pharmacyLicense"                     AS "sellerLicense",
        COALESCE(sp_s.city, t_s.city)             AS "sellerCity",
        COALESCE(sp_b."legalName", t_b.name)      AS "buyerName",
        sp_b."pharmacyLicense"                     AS "buyerLicense",
        COALESCE(sp_b.city, t_b.city)             AS "buyerCity",
        p.name                                     AS "productName",
        p."nameAr"                                 AS "productNameAr",
        p.barcode                                  AS "productBarcode",
        p.strength                                 AS "productStrength",
        ti."invoiceNumber"
      FROM p2p_orders o
      LEFT JOIN p2p_listings l       ON l.id  = o."listingId"
      LEFT JOIN products p            ON p.id  = l."productId"
      LEFT JOIN seller_profiles sp_s  ON sp_s."pharmacyTenantId" = o."sellerTenantId"
      LEFT JOIN seller_profiles sp_b  ON sp_b."pharmacyTenantId" = o."buyerTenantId"
      LEFT JOIN tenants t_s           ON t_s.id = o."sellerTenantId"
      LEFT JOIN tenants t_b           ON t_b.id = o."buyerTenantId"
      LEFT JOIN p2p_transfer_invoices ti ON ti."p2pOrderId" = o.id
      WHERE o.id = $1
      LIMIT 1
    `, [orderId]);

    if (!rows.length) throw new NotFoundException('Order not found');
    const row = rows[0];

    if (row.buyerTenantId !== tenantId && row.sellerTenantId !== tenantId)
      throw new ForbiddenException('Not your order');

    if (row.status !== 'completed')
      throw new BadRequestException('Transfer record is only available for completed orders');

    return this.renderHtml(row);
  }

  private fmt(date: Date | string | null): string {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('ar-SA', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Africa/Cairo',
    });
  }

  private renderHtml(d: any): string {
    const total = (Number(d.agreedPrice) * Number(d.requestedQty)).toFixed(2);
    const urgencyLabel: Record<string, string> = {
      normal: 'عادي', urgent: 'عاجل', critical: 'حرج',
    };

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>سند نقل الأدوية — ${d.invoiceNumber ?? d.id.slice(0, 8).toUpperCase()}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background: #f9fafb; color: #111827; font-size: 14px; }
  .page { max-width: 800px; margin: 32px auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; }
  .header { background: #1d4ed8; color: #fff; padding: 28px 32px; display: flex; justify-content: space-between; align-items: flex-start; }
  .header h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .header .sub { font-size: 13px; opacity: 0.85; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  .badge-completed { background: #d1fae5; color: #065f46; }
  .badge-urgent { background: #fef3c7; color: #92400e; }
  .badge-critical { background: #fee2e2; color: #991b1b; }
  .badge-normal { background: #e0f2fe; color: #0369a1; }
  .section { padding: 24px 32px; border-bottom: 1px solid #e5e7eb; }
  .section:last-child { border-bottom: none; }
  .section-title { font-size: 13px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .party-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
  .party-box .role { font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; margin-bottom: 6px; }
  .party-box .name { font-size: 16px; font-weight: 700; color: #111827; margin-bottom: 4px; }
  .party-box .detail { font-size: 12px; color: #6b7280; line-height: 1.6; }
  .field-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
  .field-row:last-child { border-bottom: none; }
  .field-label { color: #6b7280; font-size: 13px; }
  .field-value { font-size: 13px; font-weight: 600; color: #111827; }
  .product-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; }
  .product-name { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
  .product-name-ar { font-size: 15px; color: #374151; margin-bottom: 10px; }
  .totals { background: #1d4ed8; color: #fff; border-radius: 8px; padding: 16px 20px; text-align: center; }
  .totals .label { font-size: 12px; opacity: 0.8; margin-bottom: 4px; }
  .totals .amount { font-size: 26px; font-weight: 800; }
  .footer { background: #f8fafc; padding: 16px 32px; text-align: center; font-size: 11px; color: #9ca3af; border-top: 1px solid #e5e7eb; }
  .compliance-note { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 12px 16px; font-size: 12px; color: #92400e; margin-top: 16px; }
  @media print {
    body { background: #fff; }
    .page { margin: 0; border: none; border-radius: 0; box-shadow: none; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div>
      <h1>سند نقل الأدوية</h1>
      <div class="sub">شبكة تبادل الصيدليات (PEN) — MediPulse</div>
      <div class="sub" style="margin-top:6px;">رقم السند: ${d.invoiceNumber ?? d.id.slice(0, 8).toUpperCase()}</div>
    </div>
    <div style="text-align:left;">
      <span class="badge badge-completed">مكتمل</span>
      ${d.urgencyLevel !== 'normal' ? `<br><span class="badge badge-${d.urgencyLevel}" style="margin-top:6px;display:inline-block;">${urgencyLabel[d.urgencyLevel] ?? d.urgencyLevel}</span>` : ''}
    </div>
  </div>

  <!-- Parties -->
  <div class="section">
    <div class="section-title">أطراف الصفقة</div>
    <div class="grid-2">
      <div class="party-box">
        <div class="role">البائع (المورِّد)</div>
        <div class="name">${d.sellerName ?? '—'}</div>
        <div class="detail">
          ${d.sellerCity ? `المدينة: ${d.sellerCity}` : ''}
          ${d.sellerLicense ? `<br>رخصة: ${d.sellerLicense}` : ''}
        </div>
      </div>
      <div class="party-box">
        <div class="role">المشتري (الطرف الآخر)</div>
        <div class="name">${d.buyerName ?? '—'}</div>
        <div class="detail">
          ${d.buyerCity ? `المدينة: ${d.buyerCity}` : ''}
          ${d.buyerLicense ? `<br>رخصة: ${d.buyerLicense}` : ''}
        </div>
      </div>
    </div>
  </div>

  <!-- Product -->
  <div class="section">
    <div class="section-title">تفاصيل المنتج</div>
    <div class="product-box">
      <div class="product-name">${d.productNameAr ?? d.productName ?? 'منتج غير محدد'}</div>
      ${d.productNameAr && d.productName ? `<div class="product-name-ar">${d.productName}</div>` : ''}
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;">
        ${d.productBarcode ? `<span style="font-size:12px;color:#6b7280;">باركود: <strong>${d.productBarcode}</strong></span>` : ''}
        ${d.productStrength ? `<span style="font-size:12px;color:#6b7280;">التركيز: <strong>${d.productStrength}</strong></span>` : ''}
      </div>
    </div>
  </div>

  <!-- Order details -->
  <div class="section">
    <div class="section-title">تفاصيل الطلب</div>
    <div class="field-row">
      <span class="field-label">رقم الطلب</span>
      <span class="field-value" style="font-family:monospace;font-size:12px;">${d.id}</span>
    </div>
    <div class="field-row">
      <span class="field-label">الكمية المنقولة</span>
      <span class="field-value">${d.requestedQty} وحدة</span>
    </div>
    <div class="field-row">
      <span class="field-label">سعر الوحدة</span>
      <span class="field-value">${Number(d.agreedPrice).toFixed(2)} ج.م</span>
    </div>
    <div class="field-row">
      <span class="field-label">تاريخ الطلب</span>
      <span class="field-value">${this.fmt(d.createdAt)}</span>
    </div>
    ${d.shippedAt ? `<div class="field-row">
      <span class="field-label">تاريخ الشحن</span>
      <span class="field-value">${this.fmt(d.shippedAt)}</span>
    </div>` : ''}
    ${d.completedAt ? `<div class="field-row">
      <span class="field-label">تاريخ التسليم / الاكتمال</span>
      <span class="field-value">${this.fmt(d.completedAt)}</span>
    </div>` : ''}
    ${d.expectedDeliveryAt ? `<div class="field-row">
      <span class="field-label">تاريخ التسليم المتوقع</span>
      <span class="field-value">${this.fmt(d.expectedDeliveryAt)}</span>
    </div>` : ''}
    ${d.deliveryNote ? `<div class="field-row">
      <span class="field-label">ملاحظات التوصيل</span>
      <span class="field-value" style="font-weight:400;max-width:300px;text-align:left;">${d.deliveryNote}</span>
    </div>` : ''}
  </div>

  <!-- Total -->
  <div class="section">
    <div class="totals">
      <div class="label">إجمالي قيمة النقل</div>
      <div class="amount">${total} ج.م</div>
    </div>
    <div class="compliance-note">
      ⚠️ هذا السند وثيقة رسمية لعملية نقل الأدوية بين الصيدليات. يجب الاحتفاظ به لمدة لا تقل عن خمس سنوات وفقًا للوائح الدوائية المعمول بها.
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    صدر بواسطة نظام MediPulse — شبكة تبادل الصيدليات (PEN) &nbsp;|&nbsp; رقم التحقق: ${d.id}
    <br>هذا المستند مُنشَأ تلقائياً وصالح دون توقيع
  </div>

</div>
<script>
  // Auto-print when opened standalone
  if (window.opener == null && window.location.search.includes('print=1')) {
    window.onload = () => window.print();
  }
</script>
</body>
</html>`;
  }
}
