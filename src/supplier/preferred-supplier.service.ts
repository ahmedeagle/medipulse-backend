import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PreferredSupplier } from './entities/preferred-supplier.entity';
import { SupplierProfile } from './entities/supplier-profile.entity';

@Injectable()
export class PreferredSupplierService {
  constructor(
    @InjectRepository(PreferredSupplier)
    private readonly repo: Repository<PreferredSupplier>,
    @InjectRepository(SupplierProfile)
    private readonly profileRepo: Repository<SupplierProfile>,
  ) {}

  async connect(
    pharmacyTenantId: string,
    supplierTenantId: string,
    priority = 5,
    notes?: string,
  ): Promise<PreferredSupplier> {
    const existing = await this.repo.findOne({ where: { pharmacyTenantId, supplierTenantId } });
    if (existing) {
      await this.repo.update(existing.id, { priority, notes: notes ?? null });
      return this.repo.findOne({ where: { id: existing.id } });
    }
    return this.repo.save(
      this.repo.create({ pharmacyTenantId, supplierTenantId, priority, notes }),
    );
  }

  async disconnect(pharmacyTenantId: string, supplierTenantId: string): Promise<void> {
    const link = await this.repo.findOne({ where: { pharmacyTenantId, supplierTenantId } });
    if (!link) throw new NotFoundException('Connection not found');
    await this.repo.delete(link.id);
  }

  async listForPharmacy(pharmacyTenantId: string): Promise<PreferredSupplier[]> {
    return this.repo.find({
      where: { pharmacyTenantId },
      order: { priority: 'ASC' },
    });
  }

  /** Returns supplierTenantId list ordered by priority — used by rules engine */
  async getPriorityList(pharmacyTenantId: string): Promise<string[]> {
    const links = await this.listForPharmacy(pharmacyTenantId);
    return links.map((l) => l.supplierTenantId);
  }
}
