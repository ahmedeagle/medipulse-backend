import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { AgentDefinition }     from './entities/agent-definition.entity';
import { AgentTenantSetting }  from './entities/agent-tenant-setting.entity';
import { Approval }            from './entities/approval.entity';
import { ApprovalEvent }       from './entities/approval-event.entity';
import { InventoryItem }       from '../inventory/entities/inventory-item.entity';
import { Product }             from '../inventory/entities/product.entity';
import { Tenant }              from '../auth/entities/tenant.entity';
import { User }                from '../auth/entities/user.entity';
import { AiRecommendation }    from '../ai/entities/ai-recommendation.entity';
import { ProcurementDraft }    from '../procurement/entities/procurement-draft.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';

import { ApprovalService }     from './approval.service';
import { AgentService }        from './agent.service';
import { DashboardService }    from './dashboard.service';
import { ApprovalScheduler }   from './approval.scheduler';
import { BriefingScheduler }   from './briefing.scheduler';
import { AgentBridgeService }  from './agent-bridge.service';
import { AiCenterController }  from './ai-center.controller';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * PRD v2 — AI Governance module.
 *
 * Provides:
 *   - ApprovalService — single execution gate (PRD §11), 4-state machine.
 *   - AgentService    — agent registry + per-tenant overrides (PRD §9).
 *   - ApprovalScheduler — hourly sweeper that flips past-TTL approvals to `expired`.
 *
 * Both services are exported so domain modules (Inventory, Procurement,
 * Catalog) can `approvals.create(...)` without re-importing the entity layer.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    NotificationsModule,
    TypeOrmModule.forFeature([
      AgentDefinition,
      AgentTenantSetting,
      Approval,
      ApprovalEvent,
      InventoryItem,
      Product,
      Tenant,
      User,
      AiRecommendation,
      ProcurementDraft,
      SupplierCatalogItem,
    ]),
  ],
  providers:   [
    ApprovalService,
    AgentService,
    DashboardService,
    ApprovalScheduler,
    BriefingScheduler,
    AgentBridgeService,
  ],
  controllers: [AiCenterController],
  exports:     [ApprovalService, AgentService, TypeOrmModule],
})
export class AiGovernanceModule {}
