import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PharmacySettings } from './entities/pharmacy-settings.entity';
import { Warehouse } from './entities/warehouse.entity';
import { UpsertPharmacySettingsDto, CreateWarehouseDto, UpdateWarehouseDto } from './dto/upsert-settings.dto';

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
    });
    return this.settingsRepo.save(merged);
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
}
