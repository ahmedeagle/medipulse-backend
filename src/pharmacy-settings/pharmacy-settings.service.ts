import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PharmacySettings, NotificationSettings } from './entities/pharmacy-settings.entity';
import { Warehouse } from './entities/warehouse.entity';
import { UpsertPharmacySettingsDto, CreateWarehouseDto, UpdateWarehouseDto } from './dto/upsert-settings.dto';

/** Resolved tax + currency context for a pharmacy, used by every order-creation path. */
export interface BillingContext {
  /** ISO currency code, upper-cased (e.g. EGP, SAR, AED). */
  currency: string;
  /** VAT rate as a fraction 0..1 (e.g. 0.14). 0 when tax is disabled or jurisdiction is VAT-free. */
  vatRate: number;
  /** Whether tax is enabled for this tenant. */
  vatEnabled: boolean;
}

/** Statutory VAT rates by ISO country code (fractions). Source of truth for jurisdiction defaults. */
const VAT_BY_COUNTRY: Record<string, number> = {
  EG: 0.14, SA: 0.15, AE: 0.05, OM: 0.05, BH: 0.10, QA: 0, KW: 0, JO: 0.16,
};
/** Fallback when country is missing but currency hints at the jurisdiction. */
const VAT_BY_CURRENCY: Record<string, number> = {
  EGP: 0.14, SAR: 0.15, AED: 0.05, OMR: 0.05, BHD: 0.10, QAR: 0, KWD: 0, JOD: 0.16,
};
/** Launch market default when nothing else resolves. */
const DEFAULT_VAT_RATE = 0.14;

/** Accepts a fraction (0.14) or a percentage (14); returns a normalized fraction, or null if invalid. */
function normalizeVatRate(rate?: number | null): number | null {
  if (rate == null || !Number.isFinite(rate) || rate < 0) return null;
  return rate > 1 ? rate / 100 : rate;
}

@Injectable()
export class PharmacySettingsService {
  constructor(
    @InjectRepository(PharmacySettings)
    private readonly settingsRepo: Repository<PharmacySettings>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
  ) {}

  async getSettings(tenantId: string): Promise<PharmacySettings> {
    let settings = await this.settingsRepo.findOne({ where: { pharmacyTenantId: tenantId } });
    if (!settings) {
      settings = this.settingsRepo.create({
        pharmacyTenantId: tenantId,
        receiptSettings: { showLogo: true, showAddress: true, showPhone: true, language: 'ar', paperSize: '80mm' },
        labelSettings: { defaultSize: 'medium', barcodeType: 'CODE128', barcodeHeight: 40, showPharmacyName: true, showProductName: true, showPrice: true, showBarcode: true, showExpiry: true },
        inventorySettings: { reorderDays: 30, safetyStockPct: 20, expiryAlertDays: 90, reorderRecommendationType: 'to_safety_stock' },
      });
      await this.settingsRepo.save(settings);
    }
    return settings;
  }

  async upsertSettings(tenantId: string, dto: UpsertPharmacySettingsDto): Promise<PharmacySettings> {
    const existing = await this.getSettings(tenantId);
    const merged = this.settingsRepo.merge(existing, {
      ...dto,
      receiptSettings: dto.receiptSettings
        ? { ...existing.receiptSettings, ...dto.receiptSettings }
        : existing.receiptSettings,
      labelSettings: dto.labelSettings
        ? { ...existing.labelSettings, ...dto.labelSettings }
        : existing.labelSettings,
      inventorySettings: dto.inventorySettings
        ? { ...existing.inventorySettings, ...dto.inventorySettings }
        : existing.inventorySettings,
      notificationSettings: dto.notificationSettings
        ? { ...(existing.notificationSettings ?? {}), ...dto.notificationSettings }
        : existing.notificationSettings,
      taxSettings: dto.taxSettings
        ? { ...(existing.taxSettings ?? {}), ...dto.taxSettings }
        : existing.taxSettings,
    });
    return this.settingsRepo.save(merged);
  }

  /**
   * Resolves the currency + VAT a tenant's purchase orders must use.
   *
   * Precedence for VAT:
   *   1. Explicit `taxSettings.vatRate` (accepts fraction or percent)
   *   2. Jurisdiction default by `country` (ISO code)
   *   3. Jurisdiction default by `currency`
   *   4. Launch-market default (Egypt 14%)
   * When `taxEnabled` is false, vatRate is forced to 0.
   *
   * This is the single source of truth — every order-creation path
   * (manual POST /orders, smart-plan checkout, draft approval) must call
   * this instead of hardcoding currency/VAT.
   */
  async getBillingContext(tenantId: string): Promise<BillingContext> {
    const s = await this.getSettings(tenantId);
    const currency = (s.currency || 'EGP').toUpperCase();
    const vatEnabled = s.taxEnabled !== false;

    let vatRate = 0;
    if (vatEnabled) {
      const explicit = normalizeVatRate(s.taxSettings?.vatRate);
      if (explicit != null) {
        vatRate = explicit;
      } else {
        const country = (s.country || '').toUpperCase();
        vatRate =
          VAT_BY_COUNTRY[country] ??
          VAT_BY_CURRENCY[currency] ??
          DEFAULT_VAT_RATE;
      }
    }

    return { currency, vatRate, vatEnabled };
  }

  // ── Warehouses ───────────────────────────────────────────────────────────────

  async getWarehouses(tenantId: string): Promise<Warehouse[]> {
    return this.warehouseRepo.find({
      where: { pharmacyTenantId: tenantId },
      order: { createdAt: 'ASC' },
    });
  }

  async createWarehouse(tenantId: string, dto: CreateWarehouseDto): Promise<Warehouse> {
    const wh = this.warehouseRepo.create({ ...dto, pharmacyTenantId: tenantId });
    return this.warehouseRepo.save(wh);
  }

  async updateWarehouse(tenantId: string, id: string, dto: UpdateWarehouseDto): Promise<Warehouse> {
    const wh = await this.warehouseRepo.findOne({ where: { id, pharmacyTenantId: tenantId } });
    if (!wh) throw new NotFoundException('Warehouse not found');
    Object.assign(wh, dto);
    return this.warehouseRepo.save(wh);
  }

  async deleteWarehouse(tenantId: string, id: string): Promise<void> {
    const wh = await this.warehouseRepo.findOne({ where: { id, pharmacyTenantId: tenantId } });
    if (!wh) throw new NotFoundException('Warehouse not found');
    await this.warehouseRepo.remove(wh);
  }

  async getNotifFlag(
    tenantId: string,
    flag: keyof NotificationSettings,
  ): Promise<boolean> {
    const s = await this.getSettings(tenantId);
    const n = (s.notificationSettings ?? {}) as NotificationSettings;
    const ai = (s.aiAnalysisSettings ?? {}) as any;
    switch (flag) {
      case 'enableDeadStockAlerts':
        return n.enableDeadStockAlerts       ?? ai.enableDeadStockAlerts       ?? true;
      case 'enableExpiryAlerts':
        return n.enableExpiryAlerts          ?? ai.enableExpiryProtection      ?? true;
      case 'enableSmartProcurementAlerts':
        return n.enableSmartProcurementAlerts ?? ai.enableSmartProcurement     ?? true;
      case 'enableLowStockAlerts':
        return n.enableLowStockAlerts        ?? ai.enableLowStockAlerts        ?? true;
      default:
        return (n[flag] as boolean | undefined) ?? true;
    }
  }
}
