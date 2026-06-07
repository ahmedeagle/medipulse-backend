import {
  Controller,
  Get,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  Optional,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { IsOptional, IsString, IsDateString, IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { AuditRead } from './decorators/audit-read.decorator';

@ApiTags('audit')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @AuditRead('audit_logs')
  @Roles(Role.SYSTEM_ADMIN, Role.PHARMACY_ADMIN)
  @ApiOperation({
    summary: 'Query audit events',
    description:
      'SYSTEM_ADMIN sees all tenants. PHARMACY_ADMIN sees only their own tenant. ' +
      'Results ordered newest-first. Max 200 per page.',
  })
  @ApiQuery({ name: 'resource', required: false })
  @ApiQuery({ name: 'userId',   required: false })
  @ApiQuery({ name: 'from',     required: false, description: 'ISO 8601 datetime' })
  @ApiQuery({ name: 'to',       required: false, description: 'ISO 8601 datetime' })
  @ApiQuery({ name: 'limit',    required: false, schema: { default: 25, maximum: 200 } })
  @ApiQuery({ name: 'offset',   required: false, schema: { default: 0 } })
  @ApiOkResponse({ description: '{ data: AuditEvent[], total: number }' })
  async query(
    @CurrentUser() user: any,
    @Query('resource') resource?: string,
    @Query('userId')   userId?: string,
    @Query('from')     from?: string,
    @Query('to')       to?: string,
    @Query('limit',  new DefaultValuePipe(25),  new ParseIntPipe()) limit  = 25,
    @Query('offset', new DefaultValuePipe(0),   new ParseIntPipe()) offset = 0,
  ) {
    // Scope to own tenant unless system admin
    const tenantId = user.role === Role.SYSTEM_ADMIN ? undefined : user.tenantId;

    return this.auditService.query({
      tenantId,
      resource,
      userId,
      from:   from   ? new Date(from)   : undefined,
      to:     to     ? new Date(to)     : undefined,
      limit:  Math.min(limit,  200),
      offset: Math.max(offset, 0),
    });
  }
}
