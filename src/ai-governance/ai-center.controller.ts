import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';

import { ApprovalService } from './approval.service';
import { AgentService } from './agent.service';
import { DashboardService } from './dashboard.service';
import { ReportService, ReportPeriod } from './report.service';
import { AgentBridgeService } from './agent-bridge.service';
import { AiAuditStatsService } from './ai-audit-stats.service';
import { AiTokenBudget } from '../ai/governance/token-budget';
import { AiService } from '../ai/ai.service';
import { ExpiryLiquidationCron } from '../p2p-listing/expiry-liquidation.cron';
import {
  BulkDecideDto,
  DecideApprovalDto,
  ListApprovalsQueryDto,
  ModifyApprovalDto,
} from './dto/approval.dto';

class UpdateAgentSettingDto {
  @IsOptional() @IsBoolean()                                  enabled?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1) minConfidence?: number | null;
}

class UpdateAgentPromptDto {
  @IsOptional() systemPromptAr?: string | null;
  @IsOptional() outputSchema?: Record<string, any>;
}

/**
 * AI Center HTTP surface — PRD §7. Mounted under /ai-center to keep the
 * Workforce / Approvals / Agents / Audit views under one cohesive URL
 * namespace independent of legacy /ai endpoints.
 */
@ApiTags('AI Center')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ai-center')
export class AiCenterController {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly agents:    AgentService,
    private readonly dashboard: DashboardService,
    private readonly report:    ReportService,
    private readonly bridge:    AgentBridgeService,
    private readonly aiStats:   AiAuditStatsService,
    private readonly tokenBudget: AiTokenBudget,
    private readonly aiSvc:     AiService,
    private readonly expiryLiquidationCron: ExpiryLiquidationCron,
  ) {}

  // ── DEV ONLY: manual cron trigger (remove before prod) ──────────────────
  @Post('debug/run-expiry-liquidation-cron')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'DEV ONLY — manually trigger expiry liquidation cron' })
  async runExpiryLiquidationCron() {
    await this.expiryLiquidationCron.detectNearExpiryStock();
    return { ok: true, message: 'Expiry liquidation cron ran — check AI Center tasks tab' };
  }

  // ── Workforce Dashboard ──────────────────────────────────

  @Get('workforce/summary')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Aggregated KPIs + pending-approval preview for the dashboard home' })
  workforce(@CurrentUser() user: any) {
    return this.dashboard.summary(user.tenantId);
  }

  @Get('report')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Impact & status report: funnel, missed tasks, realized savings, backlog SLA' })
  reportSummary(@CurrentUser() user: any, @Query('period') period?: string) {
    const p: ReportPeriod = period === 'month' ? 'month' : 'week';
    return this.report.getReport(user.tenantId, p);
  }

  // ── Agents ──────────────────────────────────────────────────────────────

  @Get('agents')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'List all agents with per-tenant effective settings' })
  listAgents(@CurrentUser() user: any) {
    return this.agents.listForTenant(user.tenantId);
  }

  @Patch('agents/:code')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Override agent enable flag / confidence threshold for this tenant' })
  updateAgent(
    @CurrentUser() user: any,
    @Param('code') code: string,
    @Body() body: UpdateAgentSettingDto,
  ) {
    return this.agents.setTenantSetting(user.tenantId, code, body, user.id ?? null);
  }

  // ── Agent definitions (PRD §13: prompt + schema view/edit) ─────────────

  @Get('agents/:code/definition')
  @Roles(Role.PHARMACY_ADMIN, Role.SYSTEM_ADMIN)
  @ApiOperation({
    summary: 'Full agent definition incl. Arabic system prompt, output schema and version',
    description:
      'Returns the effective definition for the caller\'s tenant — a tenant-scoped row overrides a global built-in with the same code.',
  })
  agentDefinition(
    @CurrentUser() user: any,
    @Param('code') code: string,
  ) {
    return this.agents.getDefinitionForTenant(user.tenantId, code);
  }

  @Patch('agents/:code/definition')
  @Roles(Role.PHARMACY_ADMIN, Role.SYSTEM_ADMIN)
  @ApiOperation({
    summary: 'Edit agent prompt / output schema (bumps version for audit reproducibility)',
    description:
      'Built-in (global) agents can only be edited by SYSTEM_ADMIN. Pharmacy admins must fork to a tenant-scoped copy first (Phase 4b wizard).',
  })
  updateAgentDefinition(
    @CurrentUser() user: any,
    @Param('code') code: string,
    @Body() body: UpdateAgentPromptDto,
  ) {
    const isPlatformAdmin =
      Array.isArray(user.roles) && user.roles.includes(Role.SYSTEM_ADMIN);
    return this.agents.updatePrompt(
      user.tenantId,
      code,
      body,
      user.id,
      isPlatformAdmin,
    );
  }

  // ── Approvals ───────────────────────────────────────────────────────────

  @Get('approvals')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'List approvals (filterable + priority-sorted)' })
  list(@CurrentUser() user: any, @Query() q: ListApprovalsQueryDto) {
    return this.approvals.list(user.tenantId, q);
  }

  @Get('approvals/counts')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Lightweight badge counts (pending, critical, by status)' })
  counts(@CurrentUser() user: any) {
    return this.approvals.counts(user.tenantId);
  }

  @Get('approvals/:id')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Get one approval' })
  one(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.approvals.getOne(user.tenantId, id);
  }

  @Get('approvals/:id/events')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Full immutable decision history for one approval (audit)' })
  events(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.approvals.getEvents(user.tenantId, id);
  }

  @Patch('approvals/:id/modify')
  @Roles(Role.PHARMACY_ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Modify the payload (sets status=modified, preserves AI original)' })
  modify(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ModifyApprovalDto,
  ) {
    return this.approvals.modify(
      user.tenantId,
      id,
      body.payload,
      { userId: user.id, type: 'user' },
      body.note,
    );
  }

  @Post('approvals/:id/approve')
  @Roles(Role.PHARMACY_ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve (terminal until executed by domain service)' })
  approve(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DecideApprovalDto,
  ) {
    return this.approvals.approve(
      user.tenantId,
      id,
      { userId: user.id, type: 'user' },
      body.note,
    );
  }

  @Post('approvals/:id/reject')
  @Roles(Role.PHARMACY_ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject (terminal)' })
  reject(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DecideApprovalDto,
  ) {
    return this.approvals.reject(
      user.tenantId,
      id,
      { userId: user.id, type: 'user' },
      body.note,
    );
  }

  @Post('approvals/bulk/approve')
  @Roles(Role.PHARMACY_ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Bulk approve (skips ineligible items, reports counts)' })
  bulkApprove(@CurrentUser() user: any, @Body() body: BulkDecideDto) {
    return this.approvals.bulkApprove(
      user.tenantId,
      body.ids,
      { userId: user.id, type: 'user' },
      body.note,
    );
  }

  @Post('approvals/bulk/reject')
  @Roles(Role.PHARMACY_ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Bulk reject (skips ineligible items)' })
  bulkReject(@CurrentUser() user: any, @Body() body: BulkDecideDto) {
    return this.approvals.bulkReject(
      user.tenantId,
      body.ids,
      { userId: user.id, type: 'user' },
      body.note,
    );
  }

  // ── Audit ───────────────────────────────────────────────────────────────

  @Get('audit/approval-events')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Tenant-wide approval decision trail (newest first)' })
  approvalEvents(
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.approvals.tenantEvents(
      user.tenantId,
      Math.min(Number(limit) || 25, 500),
      Math.max(Number(offset) || 0, 0),
    );
  }

  @Get('audit/ai-runs/stats')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Aggregated GPT-call stats over the last N days (default 7)' })
  aiRunStats(@CurrentUser() user: any, @Query('days') days?: string) {
    const d = Math.min(Math.max(Number(days) || 7, 1), 90);
    return this.aiStats.stats(user.tenantId, d);
  }

  @Get('audit/ai-runs')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Recent GPT generation attempts (most recent first)' })
  aiRunsList(
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.aiStats.recent(
      user.tenantId,
      Math.min(Number(limit) || 25, 500),
      Math.max(Number(offset) || 0, 0),
    );
  }

  @Get('agents/token-usage/today')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Per-tenant AI token usage for today vs daily cap (procurement bucket)' })
  tokenUsageToday(@CurrentUser() user: any) {
    return this.tokenBudget.usageToday(user.tenantId);
  }

  /**
   * Per-feature breakdown — lets the admin see which AI surface (procurement,
   * chat, migration, whatsapp) is consuming the budget today. Backs the
   * "AI Cost" widget in the AI Center.
   */
  @Get('agents/token-usage/today/breakdown')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Per-feature AI token usage for today (cost attribution)' })
  tokenUsageBreakdownToday(@CurrentUser() user: any) {
    return this.tokenBudget.usageBreakdownToday(user.tenantId);
  }

  // ── Maintenance: on-demand bridge sync ─────────────────────────────────
  // Useful in dev / after data fixes to pull existing recs, drafts and
  // catalog suggestions into the approval queue without waiting for cron.
  // Pharmacy-admin scoped (tenant-isolated by ApprovalService).

  @Post('maintenance/sync-now')
  @Roles(Role.PHARMACY_ADMIN)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Backfill approvals from existing recommendations / drafts / catalog suggestions',
    description:
      'Idempotent. Returns per-source created/existed counts so the UI can show truthful feedback.',
  })
  syncNow(@CurrentUser() user: any) {
    return this.bridge.backfillTenant(user.tenantId);
  }

  // ── Generation (replaces legacy /ai/recommendations/generate) ─────────

  @Post('generate')
  @Roles(Role.PHARMACY_ADMIN)
  @HttpCode(202)
  @ApiOperation({
    summary: 'Enqueue an AI recommendation generation run',
    description:
      'Returns { jobId, status: "queued" } immediately. Poll GET /ai-center/generate/:jobId for results. ' +
      'Rate limited per tenant.',
  })
  generate(@CurrentUser() user: any) {
    return this.aiSvc.enqueueGeneration(user.tenantId, user.id);
  }

  @Get('generate/:jobId')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Poll AI generation job status' })
  generateStatus(
    @CurrentUser() user: any,
    @Param('jobId') jobId: string,
  ) {
    return this.aiSvc.getJobStatus(user.tenantId, jobId);
  }
}
