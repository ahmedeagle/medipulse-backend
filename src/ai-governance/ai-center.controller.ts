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
import { AgentBridgeService } from './agent-bridge.service';
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
    private readonly bridge:    AgentBridgeService,
  ) {}

  // ── Workforce Dashboard ──────────────────────────────────

  @Get('workforce/summary')
  @Roles(Role.PHARMACY_ADMIN)
  @ApiOperation({ summary: 'Aggregated KPIs + pending-approval preview for the dashboard home' })
  workforce(@CurrentUser() user: any) {
    return this.dashboard.summary(user.tenantId);
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
      Math.min(Number(limit) || 100, 500),
      Math.max(Number(offset) || 0, 0),
    );
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
}
