import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiAcceptedResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
  ApiTooManyRequestsResponse,
  ApiBody,
} from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';

import { AiService } from './ai.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { AuditRead } from '../audit/decorators/audit-read.decorator';

class FeedbackDto {
  @IsInt()
  score: 1 | -1;

  @IsOptional()
  @IsString()
  note?: string;
}

@ApiTags('ai')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PHARMACY_ADMIN)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('recommendations')
  @AuditRead('ai_recommendations')
  @ApiOperation({ summary: 'List active recommendations — ordered by risk level then date' })
  @ApiOkResponse({ description: 'Returns active (non-dismissed) recommendations' })
  getRecommendations(@CurrentUser() user: any) {
    return this.aiService.getRecommendations(user.tenantId);
  }

  @Post('recommendations/generate')
  @ApiOperation({
    summary: 'Enqueue AI recommendation generation',
    description:
      'Adds a generation job to the queue and returns a jobId immediately. ' +
      'Poll GET /ai/recommendations/job/:jobId for status and results. ' +
      'Rate limited to 10 enqueues/hour per pharmacy.',
  })
  @ApiAcceptedResponse({ description: 'Job enqueued — returns { jobId, status: "queued" }' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  enqueueGeneration(@CurrentUser() user: any) {
    return this.aiService.enqueueGeneration(user.tenantId, user.id);
  }

  @Get('recommendations/job/:jobId')
  @ApiOperation({
    summary: 'Poll generation job status',
    description:
      'Returns job state: waiting | active | completed | failed | delayed. ' +
      'When completed, includes the full recommendations array.',
  })
  @ApiOkResponse({ description: 'Job status and optional results' })
  @ApiNotFoundResponse({ description: 'Job not found (may have been auto-removed after retention window)' })
  @ApiForbiddenResponse({ description: 'Job belongs to a different pharmacy' })
  getJobStatus(
    @CurrentUser() user: any,
    @Param('jobId') jobId: string,
  ) {
    return this.aiService.getJobStatus(user.tenantId, jobId);
  }

  @Patch('recommendations/:id/dismiss')
  @ApiOperation({ summary: 'Dismiss a recommendation' })
  @ApiOkResponse({ description: 'Dismissed' })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse()
  dismiss(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.aiService.dismiss(user.tenantId, id);
  }

  @Patch('recommendations/:id/feedback')
  @ApiOperation({
    summary: 'Submit feedback on a recommendation',
    description: 'score: 1 = helpful, -1 = not helpful.',
  })
  @ApiBody({ type: FeedbackDto })
  @ApiOkResponse({ description: 'Feedback recorded' })
  @ApiNotFoundResponse()
  submitFeedback(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FeedbackDto,
  ) {
    return this.aiService.submitFeedback(user.tenantId, id, dto.score, dto.note);
  }

  @Get('audit-logs')
  @AuditRead('ai_audit_logs')
  @ApiOperation({
    summary: 'Get AI audit logs for this pharmacy (last 100)',
    description: 'Shows every generation attempt — model, tokens, latency, rules triggered, status.',
  })
  @ApiOkResponse({ description: 'Audit log entries' })
  getAuditLogs(@CurrentUser() user: any) {
    return this.aiService.getAuditLogs(user.tenantId);
  }
}
