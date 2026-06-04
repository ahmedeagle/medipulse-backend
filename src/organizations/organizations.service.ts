import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Organization, OrganizationType } from './entities/organization.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../common/enums/order-status.enum';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(InventoryItem)
    private readonly inventoryRepo: Repository<InventoryItem>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly dataSource: DataSource,
  ) {}

  // ─── SYSTEM_ADMIN: create / manage organizations ──────────────────────────

  async create(dto: { name: string; slug: string; type: OrganizationType }): Promise<Organization> {
    const existing = await this.orgRepo.findOne({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException(`Organization slug "${dto.slug}" already exists`);
    return this.orgRepo.save(this.orgRepo.create(dto));
  }

  async findAll(): Promise<Organization[]> {
    return this.orgRepo.find({ order: { name: 'ASC' } });
  }

  async addBranch(
    organizationId: string,
    tenantId: string,
    branchRole: 'branch' | 'central' = 'branch',
  ): Promise<Tenant> {
    const org = await this.orgRepo.findOne({ where: { id: organizationId } });
    if (!org) throw new NotFoundException(`Organization ${organizationId} not found`);
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);
    await this.tenantRepo.update(tenantId, { organizationId, branchRole });
    return this.tenantRepo.findOne({ where: { id: tenantId } });
  }

  async removeBranch(tenantId: string): Promise<Tenant> {
    await this.tenantRepo.update(tenantId, { organizationId: null, branchRole: 'standalone' });
    return this.tenantRepo.findOne({ where: { id: tenantId } });
  }

  // ─── CHAIN_ADMIN: cross-branch read views ─────────────────────────────────

  async getBranches(organizationId: string): Promise<Tenant[]> {
    return this.tenantRepo.find({
      where: { organizationId },
      order: { name: 'ASC' },
    });
  }

  /**
   * Cross-branch inventory view — all branches' low-stock items in one list.
   * CHAIN_ADMIN can see which branches need procurement attention.
   */
  async getAggregatedInventory(
    organizationId: string,
  ): Promise<{ tenantId: string; tenantName: string; lowStockItems: InventoryItem[] }[]> {
    const branches = await this.getBranches(organizationId);
    if (!branches.length) return [];

    const branchIds = branches.map((b) => b.id);
    const lowStockItems = await this.inventoryRepo
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.product', 'p')
      .where('i.pharmacyTenantId IN (:...branchIds)', { branchIds })
      .andWhere('i.deletedAt IS NULL')
      .andWhere('i.quantity <= i.minThreshold')
      .orderBy('i.quantity', 'ASC')
      .getMany();

    const tenantMap = new Map(branches.map((b) => [b.id, b.name]));
    const grouped = new Map<string, InventoryItem[]>();
    for (const item of lowStockItems) {
      if (!grouped.has(item.pharmacyTenantId)) grouped.set(item.pharmacyTenantId, []);
      grouped.get(item.pharmacyTenantId).push(item);
    }

    return branches
      .filter((b) => grouped.has(b.id))
      .map((b) => ({
        tenantId:      b.id,
        tenantName:    b.name,
        lowStockItems: grouped.get(b.id) ?? [],
      }));
  }

  /**
   * All orders across branches — useful for a chain's central procurement team.
   */
  async getAggregatedOrders(
    organizationId: string,
    statusFilter?: OrderStatus[],
  ): Promise<Order[]> {
    const branches = await this.getBranches(organizationId);
    if (!branches.length) return [];

    const branchIds = branches.map((b) => b.id);
    const qb = this.orderRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.items', 'items')
      .leftJoinAndSelect('items.product', 'product')
      .leftJoinAndSelect('o.pharmacyTenant', 'pharmacyTenant')
      .leftJoinAndSelect('o.supplierTenant', 'supplierTenant')
      .where('o.pharmacyTenantId IN (:...branchIds)', { branchIds });

    if (statusFilter?.length) {
      qb.andWhere('o.status IN (:...statuses)', { statuses: statusFilter });
    }

    return qb.orderBy('o.createdAt', 'DESC').getMany();
  }

  /**
   * Spend analytics by branch and category — for centralized procurement reporting.
   */
  async getSpendAnalytics(organizationId: string): Promise<{
    branchId:      string;
    branchName:    string;
    totalSpend:    number;
    orderCount:    number;
    currency:      string;
  }[]> {
    const branches = await this.getBranches(organizationId);
    if (!branches.length) return [];

    const branchIds = branches.map((b) => b.id);
    const rows: Array<{ pharmacyTenantId: string; totalSpend: string; orderCount: string }> =
      await this.dataSource.query(
        `
        SELECT
          o."pharmacyTenantId",
          SUM(o."totalAmount") AS "totalSpend",
          COUNT(o.id)          AS "orderCount"
        FROM orders o
        WHERE o."pharmacyTenantId" = ANY($1)
          AND o.status = 'delivered'
          AND o."createdAt" >= NOW() - INTERVAL '90 days'
        GROUP BY o."pharmacyTenantId"
        `,
        [branchIds],
      );

    const rowMap = new Map(rows.map((r) => [r.pharmacyTenantId, r]));
    return branches.map((b) => {
      const row = rowMap.get(b.id);
      return {
        branchId:   b.id,
        branchName: b.name,
        totalSpend: row ? parseFloat(row.totalSpend) : 0,
        orderCount: row ? parseInt(row.orderCount, 10) : 0,
        currency:   'SAR',
      };
    });
  }
}
