import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiBody,
} from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Throttle } from '@nestjs/throttler';
import { ProcurementDraftService } from './procurement-draft.service';
import { ProcurementOrchestrator } from './procurement-orchestrator.service';
import { ProcurementCartService } from './procurement-cart.service';
import { AskAgentService } from './ask-agent.service';
import { AskAgentDto, AskApplyDto } from './dto/ask-agent.dto';
import { SimulationConstraints } from './procurement-orchestrator.types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { AuditRead } from '../audit/decorators/audit-read.decorator';

class RejectDraftDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

class GeneratePlanDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  qty: number;

  @IsOptional()
  constraints?: SimulationConstraints;
}

class SimulatePlanDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  qty: number;

  @IsOptional()
  constraints?: SimulationConstraints;
}

class AddToCartDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  qty: number;
}

class UpdateCartItemDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  qty?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;
}

class PlanSplitInputDto {
  @IsIn(['p2p', 'supplier'])
  source: string;

  @IsUUID()
  sourceId: string;

  @IsString()
  @IsNotEmpty()
  sourceName: string;

  @IsInt()
  @Min(1)
  qty: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;
}

class ApplyPlanInputDto {
  @IsUUID()
  productId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PlanSplitInputDto)
  splits: PlanSplitInputDto[];

  @IsNumber()
  @Min(0)
  totalCost: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  riskScore: number;

  @IsInt()
  @Min(1)
  @Max(100_000)
  qtyRequired: number;
}

class ApplyPlanDto {
  @IsObject()
  @ValidateNested()
  @Type(() => ApplyPlanInputDto)
  plan: ApplyPlanInputDto;
}

@ApiTags('procurement')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PHARMACY_ADMIN)
@Controller('procurement')
export class ProcurementController {
  constructor(
    private readonly draftService: ProcurementDraftService,
    private readonly orchestrator: ProcurementOrchestrator,
    private readonly cart: ProcurementCartService,
    private readonly askAgentSvc: AskAgentService,
  ) {}

  @Get('queue')
  @ApiOperation({
    summary: 'Smart Procurement Queue — pharmacy morning cockpit',
    description:
      'Returns a prioritised view of: pending auto-drafts (urgency ordered), ' +
      'inventory items expiring within 30 days, and in-flight orders awaiting supplier action.',
  })
  @ApiOkResponse({ description: '{ criticalDrafts, expiringStock, pendingOrders }' })
  getQueue(@CurrentUser() user: any) {
    return this.draftService.getProcurementQueue(user.tenantId);
  }

  @Get('drafts')
  @AuditRead('procurement_drafts')
  @ApiOperation({ summary: 'List pending auto-generated procurement drafts' })
  @ApiOkResponse({ description: 'Drafts ordered by urgency then creation date' })
  listDrafts(@CurrentUser() user: any) {
    return this.draftService.findPending(user.tenantId);
  }

  @Post('drafts/:id/approve')
  @ApiOperation({
    summary: 'One-click approve — converts draft to a real order atomically',
    description: 'Verifies supplier availability, creates Order + OrderItem in a single transaction.',
  })
  @ApiCreatedResponse({ description: 'Order created — same response as POST /orders' })
  approveDraft(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.draftService.approveDraft(user.tenantId, id);
  }

  @Delete('drafts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBody({ type: RejectDraftDto })
  @ApiOperation({ summary: 'Reject a draft — records reason for analytics' })
  @ApiNoContentResponse()
  rejectDraft(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDraftDto,
  ) {
    return this.draftService.rejectDraft(user.tenantId, id, dto.reason);
  }

  /**
   * Procurement Decision Engine — generates an AI-driven multi-source procurement plan.
   *
   * Combines: demand forecast · spike detection · financial constraints · P2P availability ·
   * supplier reliability · market availability · price intelligence
   *
   * Returns a split plan (P2P + Supplier A + Supplier B) with:
   *   - riskScore 0–100
   *   - confidence 0–100
   *   - full explainability record (mandatory per PRD §14)
   *   - conflict resolution rules that fired
   */
  @Post('plan')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: 'Generate AI procurement plan (Procurement Decision Engine)',
    description:
      'Runs all 4 layers: signal collection → normalization → conflict resolution → plan generation. ' +
      'Returns multi-source split plan with full explainability (PRD §14).',
  })
  @ApiCreatedResponse({ description: 'OrchestratorResult with splits, riskScore, explainability' })
  generatePlan(@CurrentUser() user: any, @Body() dto: GeneratePlanDto) {
    return this.orchestrator.generatePlan(
      user.tenantId,
      dto.productId,
      dto.qty,
      { ...dto.constraints, triggerEvent: 'manual' },
    );
  }

  /**
   * Simulation Mode — "what if?" scenario planning before committing.
   *
   * Example: { delayDays: 3 } → compares baseline plan vs delayed plan
   * Example: { sourceFilter: 'p2p_only' } → what if we only buy from P2P?
   * Example: { maxBudget: 5000 } → what plan fits within budget?
   */
  @Post('simulate')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: 'Simulate procurement scenario — compare baseline vs constrained plan',
    description:
      'Runs the Procurement Decision Engine twice (baseline + constrained) and returns ' +
      'a side-by-side comparison with cost delta, risk delta, and AI recommendation.',
  })
  @ApiOkResponse({ description: '{ baseline, simulated, costDelta, riskDelta, recommendation }' })
  async simulatePlan(@CurrentUser() user: any, @Body() dto: SimulatePlanDto) {
    const [baseline, simulated] = await Promise.all([
      this.orchestrator.generatePlan(user.tenantId, dto.productId, dto.qty, {
        triggerEvent: 'manual',
      }),
      this.orchestrator.generatePlan(user.tenantId, dto.productId, dto.qty, {
        ...dto.constraints,
        triggerEvent: 'manual',
      }),
    ]);

    const costDelta = simulated.totalCost - baseline.totalCost;
    const riskDelta = simulated.riskScore - baseline.riskScore;

    let recommendation: string;
    if (riskDelta < -5 && costDelta <= 0) {
      recommendation = 'السيناريو المحاكى أفضل — مخاطر أقل وتكلفة أقل أو مساوية';
    } else if (riskDelta > 5 && costDelta > 0) {
      recommendation = 'الخطة الأصلية أفضل — السيناريو المحاكى أغلى وأكثر خطورة';
    } else if (riskDelta < -5) {
      recommendation = 'السيناريو المحاكى يقلل المخاطر لكن بتكلفة أعلى — قرارك';
    } else {
      recommendation = 'الفرق ضئيل — كلا الخطتين مقبولتان';
    }

    return { baseline, simulated, costDelta, riskDelta, recommendation };
  }

  // ─── CART ENDPOINTS (Procurement Draft Plan) ────────────────────────────────

  @Post('cart/add')
  @ApiOperation({
    summary: 'Add product to procurement cart (Procurement Draft Plan)',
    description:
      'Runs the Procurement Decision Engine → creates one ProcurementDraft per split. ' +
      'Replaces any existing pending plan for the same product.',
  })
  @ApiCreatedResponse({ description: 'OrchestratorResult — AI plan for this product' })
  addToCart(@CurrentUser() user: any, @Body() dto: AddToCartDto) {
    return this.cart.addToCart(user.tenantId, dto.productId, dto.qty);
  }

  @Get('cart')
  @ApiOperation({
    summary: 'Get procurement cart — all pending AI-plan splits with staleness flags',
    description:
      'Returns items grouped with stale=true when signals are >30 min old. ' +
      'Each item includes riskScore, confidence, and full explainability.',
  })
  @ApiOkResponse({ description: 'CartSummary with items, totalCost, hasStaleItems' })
  getCart(@CurrentUser() user: any) {
    return this.cart.getCart(user.tenantId);
  }

  @Post('cart/recompute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recompute stale cart items — refresh prices + availability',
    description:
      'Re-runs orchestrator for each product with stale signals. ' +
      'Returns a diff: oldCost → newCost, riskDelta per product.',
  })
  @ApiOkResponse({ description: '{ recomputedProducts, changes[] }' })
  recomputeCart(@CurrentUser() user: any) {
    return this.cart.recomputeCart(user.tenantId);
  }

  @Delete('cart/:draftId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a single split from the cart' })
  @ApiNoContentResponse()
  removeCartItem(
    @CurrentUser() user: any,
    @Param('draftId', ParseUUIDPipe) draftId: string,
  ) {
    return this.cart.removeCartItem(user.tenantId, draftId);
  }

  @Patch('cart/:draftId')
  @ApiOperation({
    summary: 'Inline-edit a cart line (qty or unit price)',
    description:
      'Updates qty and/or unitPrice on a pending cart draft. ' +
      'A manual price override clears the freshness timestamp so the ' +
      'line shows as stale, prompting the user to recompute the plan.',
  })
  @ApiOkResponse({ description: 'Updated CartItem' })
  updateCartItem(
    @CurrentUser() user: any,
    @Param('draftId', ParseUUIDPipe) draftId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cart.updateCartItem(user.tenantId, draftId, dto);
  }

  @Post('cart/apply-plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Apply a simulated plan to the cart',
    description:
      'Replaces all pending ai_plan drafts for the product with splits from ' +
      'the provided OrchestratorResult (e.g. from the /simulate endpoint). ' +
      'Returns the updated CartSummary.',
  })
  @ApiOkResponse({ description: 'Updated CartSummary' })
  applyPlan(@CurrentUser() user: any, @Body() dto: ApplyPlanDto) {
    // ApplyPlanInputDto is a validated strict subset of OrchestratorResult.
    // The service stores the snapshot as opaque JSON, so the cast is safe.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.cart.applyPlan(user.tenantId, dto.plan as any);
  }

  @Post('cart/checkout')
  @ApiOperation({
    summary: 'Checkout procurement cart — execute all pending splits atomically',
    description:
      'Supplier splits → PurchaseOrders. P2P splits → p2p_orders. ' +
      'All-or-nothing transaction. Returns created order IDs.',
  })
  @ApiCreatedResponse({ description: '{ supplierOrderIds, p2pOrderIds, checkedOutDraftIds }' })
  checkoutCart(@CurrentUser() user: any) {
    return this.cart.checkoutCart(user.tenantId);
  }

  // ─── ASK AGENT (Conversational intake — P3) ─────────────────────────────────

  /**
   * Free-text procurement intake.
   *
   * Pharmacist types something like "محتاج ٥٠ أوجمنتين و٣٠ بانادول" or
   * "50 augmentin 1g, 30 panadol extra" — the backend parses it, resolves
   * each line to a Product, and runs the Procurement Decision Engine for
   * every match. No DB writes — this endpoint returns a preview only.
   *
   * Throttled because each call fans out into N orchestrator runs.
   */
  @Post('ask')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({
    summary: 'Conversational procurement intake — parse free text into a draft plan',
    description:
      'Parses Arabic or English free text, resolves each line to a Product, ' +
      'and runs the Procurement Decision Engine per match. Read-only preview.',
  })
  @ApiOkResponse({
    description: '{ items: ResolvedLine[], unparsable: string[], totalCost, highestRisk }',
  })
  askAgent(@CurrentUser() user: any, @Body() dto: AskAgentDto) {
    return this.askAgentSvc.preview(user.tenantId, dto.text);
  }

  /**
   * Bulk-adds the items the user confirmed in the AskAgent preview to the
   * procurement cart. Each line goes through the existing addToCart pipeline
   * so explainability, staleness, and approval routing all work identically
   * to manually-added items.
   */
  @Post('ask/apply')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: 'Apply confirmed AskAgent items to the cart',
    description:
      'Adds each (productId, qty) pair to the procurement cart via the ' +
      'standard Decision Engine pipeline. Returns counts plus a list of ' +
      'any items the cart layer refused (e.g. no supplier available).',
  })
  @ApiCreatedResponse({ description: '{ added: number, skipped: Array<{productId, reason}> }' })
  applyAsk(@CurrentUser() user: any, @Body() dto: AskApplyDto) {
    return this.askAgentSvc.apply(user.tenantId, dto.items);
  }
}
