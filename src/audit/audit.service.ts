import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEvent } from './entities/audit-event.entity';

export interface AuditQuery {
  tenantId?: string;
  resource?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditEvent, 'audit')
    private readonly auditRepo: Repository<AuditEvent>,
  ) {}

  async query(params: AuditQuery): Promise<{ data: AuditEvent[]; total: number }> {
    const qb = this.auditRepo
      .createQueryBuilder('e')
      .orderBy('e.createdAt', 'DESC')
      .take(params.limit ?? 50)
      .skip(params.offset ?? 0);

    if (params.tenantId) qb.andWhere('e.tenantId = :tenantId', { tenantId: params.tenantId });
    if (params.resource)  qb.andWhere('e.resource = :resource', { resource: params.resource });
    if (params.userId)    qb.andWhere('e.userId = :userId',     { userId: params.userId });
    if (params.from)      qb.andWhere('e.createdAt >= :from',   { from: params.from });
    if (params.to)        qb.andWhere('e.createdAt <= :to',     { to: params.to });

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }
}
