import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface LogMissDto {
  productId?:   string;
  productName:  string;
  quantity?:    number;
  sellingPrice?: number;
  source?:      'pos_manual' | 'inventory_search';
}

export interface MissedDemandReport {
  days:               number;
  totalMissedEntries: number;
  totalEstimatedLoss: number;
  topMissedProducts:  Array<{
    productId:      string | null;
    productName:    string;
    missCount:      number;
    totalQty:       number;
    estimatedLoss:  number;
  }>;
  dailyTrend: Array<{
    date:           string;
    missCount:      number;
    estimatedLoss:  number;
  }>;
}

@Injectable()
export class MissedDemandService {
  private readonly logger = new Logger(MissedDemandService.name);

  constructor(private readonly dataSource: DataSource) {}

  async logMiss(tenantId: string, dto: LogMissDto): Promise<void> {
    const qty             = dto.quantity ?? 1;
    const estimatedLoss   = dto.sellingPrice ? +(dto.sellingPrice * qty).toFixed(2) : null;
    await this.dataSource.query(`
      INSERT INTO missed_demand_entries ("tenantId","productId","productName",quantity,"estimatedLostEgp",source)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [tenantId, dto.productId ?? null, dto.productName, qty, estimatedLoss, dto.source ?? 'pos_manual']);
    this.logger.log(`Missed demand logged: "${dto.productName}" (${qty}) — tenant ${tenantId}`);
  }

  async getReport(tenantId: string, days = 30): Promise<MissedDemandReport> {
    const [totals] = await this.dataSource.query<any[]>(`
      SELECT
        COUNT(*)::int                              AS total_entries,
        COALESCE(SUM("estimatedLostEgp"),0)::float AS total_loss
      FROM missed_demand_entries
      WHERE "tenantId" = $1
        AND "createdAt" >= NOW() - INTERVAL '${days} days'
    `, [tenantId]);

    const topRows = await this.dataSource.query<any[]>(`
      SELECT
        "productId",
        "productName",
        COUNT(*)::int                              AS miss_count,
        SUM(quantity)::int                         AS total_qty,
        COALESCE(SUM("estimatedLostEgp"),0)::float AS estimated_loss
      FROM missed_demand_entries
      WHERE "tenantId" = $1
        AND "createdAt" >= NOW() - INTERVAL '${days} days'
      GROUP BY "productId","productName"
      ORDER BY miss_count DESC
      LIMIT 20
    `, [tenantId]);

    const trendRows = await this.dataSource.query<any[]>(`
      SELECT
        "createdAt"::date::text                    AS date,
        COUNT(*)::int                              AS miss_count,
        COALESCE(SUM("estimatedLostEgp"),0)::float AS estimated_loss
      FROM missed_demand_entries
      WHERE "tenantId" = $1
        AND "createdAt" >= NOW() - INTERVAL '${days} days'
      GROUP BY "createdAt"::date
      ORDER BY "createdAt"::date ASC
    `, [tenantId]);

    return {
      days,
      totalMissedEntries: totals?.total_entries ?? 0,
      totalEstimatedLoss: totals?.total_loss    ?? 0,
      topMissedProducts: topRows.map(r => ({
        productId:     r.product_id    ?? null,
        productName:   r.productName   ?? 'غير معروف',
        missCount:     r.miss_count,
        totalQty:      r.total_qty,
        estimatedLoss: r.estimated_loss,
      })),
      dailyTrend: trendRows.map(r => ({
        date:          r.date,
        missCount:     r.miss_count,
        estimatedLoss: r.estimated_loss,
      })),
    };
  }
}
