import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SellerProfile } from './entities/seller-profile.entity';
import { UpsertSellerProfileDto } from './dto/upsert-seller-profile.dto';
import { P2P_EVENTS } from '../events/domain-events';
import {
  normalizePagination,
  PaginatedResult,
  PaginationQueryDto,
} from '../common/pagination/pagination-query.dto';

export interface SellerStats {
  completedOrdersCount: number
  pendingOrdersCount: number
  totalQtySold: number
  totalRevenue: number
}

@Injectable()
export class SellerProfileService {
  constructor(
    @InjectRepository(SellerProfile)
    private readonly repo: Repository<SellerProfile>,
    private readonly events: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  async upsert(pharmacyTenantId: string, dto: UpsertSellerProfileDto): Promise<SellerProfile> {
    const existing = await this.repo.findOne({ where: { pharmacyTenantId } });

    if (existing) {
      const wasVerified = existing.verificationStatus === 'verified';
      await this.repo.update(existing.id, {
        ...dto,
        verificationStatus: wasVerified ? 'pending' : existing.verificationStatus,
        updatedAt: new Date(),
      });
      const updated = await this.repo.findOne({ where: { id: existing.id } });
      // Emit re-submission event so admin knows to re-review
      if (wasVerified) {
        this.events.emit(P2P_EVENTS.PROFILE_SUBMITTED, {
          pharmacyTenantId,
          legalName: updated.legalName,
          isResubmission: true,
        });
      }
      return updated;
    }

    const created = await this.repo.save(
      this.repo.create({ pharmacyTenantId, ...dto, verificationStatus: 'pending' }),
    );
    this.events.emit(P2P_EVENTS.PROFILE_SUBMITTED, {
      pharmacyTenantId,
      legalName: created.legalName,
      isResubmission: false,
    });
    return created;
  }

  async getOwn(pharmacyTenantId: string): Promise<SellerProfile | null> {
    return this.repo.findOne({ where: { pharmacyTenantId } });
  }

  async findById(pharmacyTenantId: string): Promise<SellerProfile> {
    const profile = await this.repo.findOne({ where: { pharmacyTenantId } });
    if (!profile) throw new NotFoundException('Seller profile not found');
    return profile;
  }

  async resetLegalAck(pharmacyTenantId: string): Promise<void> {
    const existing = await this.repo.findOne({ where: { pharmacyTenantId } });
    if (existing) {
      await this.repo.update(existing.id, { lastLegalAckAt: null });
    }
  }

  private static readonly DOC_COL_MAP: Record<string, keyof SellerProfile> = {
    pharmacy_license:   'pharmacyLicenseUrl',
    commercial_reg:     'commercialRegUrl',
    tax_doc:            'taxDocUrl',
    pharmacist_license: 'pharmacistLicenseUrl',
    license_holder_id:  'licenseHolderIdUrl',
    municipal_permit:   'municipalPermitUrl',
    vat_cert:           'vatCertUrl',
  };

  /** Store an uploaded document URL. If profile was verified, resets to pending and emits re-submission event. */
  async saveDocUrl(
    pharmacyTenantId: string,
    docType: string,
    fileUrl: string,
  ): Promise<SellerProfile> {
    const col = SellerProfileService.DOC_COL_MAP[docType];
    if (!col) throw new BadRequestException(`Unknown document type: ${docType}`);

    const existing = await this.repo.findOne({ where: { pharmacyTenantId } });

    if (!existing) {
      return this.repo.save(
        this.repo.create({
          pharmacyTenantId,
          legalName: '',
          verificationStatus: 'pending',
          isVisible: false,
          [col]: fileUrl,
        }),
      );
    }

    const patch: Partial<SellerProfile> = { [col]: fileUrl };
    const wasVerified = existing.verificationStatus === 'verified';
    if (wasVerified) patch.verificationStatus = 'pending';

    await this.repo.update(existing.id, patch);
    const updated = await this.repo.findOne({ where: { id: existing.id } });
    if (!updated) throw new NotFoundException('Profile disappeared after update');

    if (wasVerified) {
      this.events.emit(P2P_EVENTS.PROFILE_SUBMITTED, {
        pharmacyTenantId,
        legalName: existing.legalName,
        isResubmission: true,
      });
    }
    return updated;
  }

  async recordLegalAck(pharmacyTenantId: string): Promise<void> {
    const existing = await this.repo.findOne({ where: { pharmacyTenantId } });
    if (!existing) {
      await this.repo.save(
        this.repo.create({
          pharmacyTenantId,
          legalName: '',
          verificationStatus: 'pending',
          isVisible: false,
          lastLegalAckAt: new Date(),
        }),
      );
      return;
    }
    await this.repo.update(existing.id, { lastLegalAckAt: new Date() });
  }

  async listAll(
    status?: string,
    pagination: PaginationQueryDto = {},
  ): Promise<PaginatedResult<SellerProfile>> {
    const { limit, offset } = normalizePagination(pagination);
    const where = status ? { verificationStatus: status as any } : {};
    const [data, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { data, total, limit, offset };
  }

  async verify(pharmacyTenantId: string): Promise<SellerProfile> {
    const profile = await this.findById(pharmacyTenantId);
    await this.repo.update(profile.id, { verificationStatus: 'verified', rejectionReason: null });
    const updated = await this.repo.findOne({ where: { id: profile.id } });
    this.events.emit(P2P_EVENTS.PROFILE_VERIFIED, {
      pharmacyTenantId,
      legalName: profile.legalName,
    });
    return updated;
  }

  async reject(pharmacyTenantId: string, reason: string): Promise<SellerProfile> {
    const profile = await this.findById(pharmacyTenantId);
    await this.repo.update(profile.id, { verificationStatus: 'rejected', rejectionReason: reason });
    const updated = await this.repo.findOne({ where: { id: profile.id } });
    this.events.emit(P2P_EVENTS.PROFILE_REJECTED, {
      pharmacyTenantId,
      legalName: profile.legalName,
      reason,
    });
    return updated;
  }

  needsLegalAck(profile: SellerProfile): boolean {
    if (!profile.lastLegalAckAt) return true;
    const daysSinceAck = (Date.now() - new Date(profile.lastLegalAckAt).getTime()) / 86_400_000;
    return daysSinceAck >= 90;
  }

  // Single aggregate query — one round-trip regardless of order volume
  async getSellerStats(sellerTenantId: string): Promise<SellerStats> {
    const [row] = await this.dataSource.query<SellerStats[]>(`
      SELECT
        COUNT(*)                     FILTER (WHERE status = 'completed') ::int  AS "completedOrdersCount",
        COUNT(*)                     FILTER (WHERE status = 'pending')   ::int  AS "pendingOrdersCount",
        COALESCE(SUM("requestedQty") FILTER (WHERE status = 'completed'), 0)::int AS "totalQtySold",
        COALESCE(SUM("agreedPrice" * "requestedQty") FILTER (WHERE status = 'completed'), 0)::numeric AS "totalRevenue"
      FROM p2p_orders
      WHERE "sellerTenantId" = $1
    `, [sellerTenantId]);

    return {
      completedOrdersCount: row.completedOrdersCount,
      pendingOrdersCount:   row.pendingOrdersCount,
      totalQtySold:         row.totalQtySold,
      totalRevenue:         Number(row.totalRevenue),
    };
  }
}
