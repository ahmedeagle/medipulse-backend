import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { AiModule }            from '../ai/ai.module';
import { AgentDefinition }     from './entities/agent-definition.entity';
import { AgentTenantSetting }  from './entities/agent-tenant-setting.entity';
import { Approval }            from './entities/approval.entity';
import { ApprovalEvent }       from './entities/approval-event.entity';
import { InventoryItem }       from '../inventory/entities/inventory-item.entity';
import { Product }             from '../inventory/entities/product.entity';
import { Tenant }              from '../auth/entities/tenant.entity';
import { User }                from '../auth/entities/user.entity';
import { AiRecommendation }    from '../ai/entities/ai-recommendation.entity';
import { AiAuditLog }          from '../ai/entities/ai-audit-log.entity';
import { ProcurementDraft }    from '../procurement/entities/procurement-draft.entity';
import { SupplierCatalogItem } from '../supplier/entities/supplier-catalog-item.entity';

import { ApprovalService }           from './approval.service';
import { AgentService }              from './agent.service';
import { DashboardService }          from './dashboard.service';
import { ApprovalScheduler }         from './approval.scheduler';
import { BriefingScheduler }         from './briefing.scheduler';
import { AgentBridgeService }        from './agent-bridge.service';
import { AiAuditStatsService }       from './ai-audit-stats.service';
import { AiTokenBudget }             from '../ai/governance/token-budget';
import { AiCenterController }        from './ai-center.controller';
import { NotificationsModule }       from '../notifications/notifications.module';
import { CronLockModule }            from '../common/cron-lock/cron-lock.module';
import { SmartProcurementExecutor }    from './executors/smart-procurement.executor';
import { ListingSuggestionExecutor }   from './executors/listing-suggestion.executor';
import { ExpiredQuarantineExecutor }   from './executors/expired-quarantine.executor';
import { P2pOrderActionExecutor }      from './executors/p2p-order-action.executor';
import { P2pOrderMonitorCron }         from '../p2p-orders/p2p-order-monitor.cron';
import { P2pOrdersModule }             from '../p2p-orders/p2p-orders.module';
import { PosShiftActionExecutor }      from './executors/pos-shift-action.executor';
import { ExpiryLiquidationCron }       from '../p2p-listing/expiry-liquidation.cron';
import { ExpiryLiquidationExecutor }   from './executors/expiry-liquidation.executor';
import { LowStockExecutor }            from './executors/low-stock.executor';
import { DeadStockExecutor }           from './executors/dead-stock.executor';
import { LostRevenueExecutor }         from './executors/lost-revenue.executor';

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
    CronLockModule,
    AiModule,
    P2pOrdersModule,
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
      AiAuditLog,
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
    AiAuditStatsService,
    AiTokenBudget,
    // Approval executors — one per subjectType
    SmartProcurementExecutor,
    ListingSuggestionExecutor,
    ExpiredQuarantineExecutor,
    P2pOrderActionExecutor,
    PosShiftActionExecutor,
    ExpiryLiquidationExecutor,
    LowStockExecutor,
    DeadStockExecutor,
    LostRevenueExecutor,
    // Background monitor crons
    P2pOrderMonitorCron,
    ExpiryLiquidationCron,
  ],
  controllers: [AiCenterController],
  exports:     [ApprovalService, AgentService, TypeOrmModule],
})
export class AiGovernanceModule {}
