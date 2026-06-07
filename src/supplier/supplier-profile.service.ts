import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupplierProfile, ProfileStatus } from './entities/supplier-profile.entity';
import {
  normalizePagination,
  PaginatedResult,
  PaginationQueryDto,
} from '../common/pagination/pagination-query.dto';

@Injectable()
export class SupplierProfileService {
  constructor(
    @InjectRepository(SupplierProfile)
    private readonly repo: Repository<SupplierProfile>,
  ) {}

  // ── Supplier: manage own profile ──────────────────────────────────────────

  async upsert(
    supplierTenantId: string,
    dto: Partial<Omit<SupplierProfile, 'id' | 'supplierTenantId' | 'status' | 'verifiedAt' | 'rejectionReason' | 'createdAt' | 'updatedAt'>>,
  ): Promise<SupplierProfile> {
    const existing = await this.repo.findOne({ where: { supplierTenantId } });

    if (existing) {
      // Reset to pending_review on any update so admin re-verifies
      await this.repo.update(existing.id, {
        ...dto,
        status: existing.status === 'verified' ? 'pending_review' : existing.status,
      });
      return this.repo.findOne({ where: { id: existing.id } });
    }

    return this.repo.save(
      this.repo.create({ supplierTenantId, ...dto, status: 'pending_review' }),
    );
  }

  async getOwn(supplierTenantId: string): Promise<SupplierProfile | null> {
    return this.repo.findOne({ where: { supplierTenantId } });
  }

  // ── Public: pharmacy reads supplier profiles ──────────────────────────────

  async findById(supplierTenantId: string): Promise<SupplierProfile> {
    const profile = await this.repo.findOne({ where: { supplierTenantId } });
    if (!profile) throw new NotFoundException(`Supplier profile not found`);
    return profile;
  }

  async findAll(
    status?: ProfileStatus,
    pagination: PaginationQueryDto = {},
  ): Promise<PaginatedResult<SupplierProfile>> {
    const { limit, offset } = normalizePagination(pagination);
    const where = status ? { status } : {};
    const [data, total] = await this.repo.findAndCount({
      where,
      order: { companyName: 'ASC' },
      take: limit,
      skip: offset,
    });
    return { data, total, limit, offset };
  }

  /** Suppliers in a given delivery zone — used by demand signal queries */
  async findByZone(region: string): Promise<SupplierProfile[]> {
    return this.repo
      .createQueryBuilder('p')
      .where('p.deliveryZones @> :zone::jsonb', { zone: JSON.stringify([region]) })
      .andWhere('p.status = :status', { status: 'verified' })
      .getMany();
  }

  // ── Admin: verify / reject ─────────────────────────────────────────────────

  async verify(supplierTenantId: string): Promise<SupplierProfile> {
    const profile = await this.findById(supplierTenantId);
    await this.repo.update(profile.id, { status: 'verified', verifiedAt: new Date(), rejectionReason: null });
    return this.repo.findOne({ where: { id: profile.id } });
  }

  async reject(supplierTenantId: string, reason: string): Promise<SupplierProfile> {
    const profile = await this.findById(supplierTenantId);
    await this.repo.update(profile.id, { status: 'rejected', rejectionReason: reason });
    return this.repo.findOne({ where: { id: profile.id } });
  }

  async suspend(supplierTenantId: string): Promise<SupplierProfile> {
    const profile = await this.findById(supplierTenantId);
    await this.repo.update(profile.id, { status: 'suspended' });
    return this.repo.findOne({ where: { id: profile.id } });
  }
}
