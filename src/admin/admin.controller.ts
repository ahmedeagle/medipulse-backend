import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { DlqService } from './dlq.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly dlqService: DlqService,
  ) {}

  @Get('tenants')
  @ApiOperation({ summary: 'Get tenants with user counts (paginated, system admin only)' })
  @ApiOkResponse({ description: '{ data, total, limit, offset } — default 25 per page' })
  findAllTenants(@Query() pagination: PaginationQueryDto) {
    return this.adminService.findAllTenants(pagination);
  }

  @Post('tenants')
  @ApiOperation({ summary: 'Create a new tenant (system admin only)' })
  @ApiCreatedResponse({ description: 'Tenant created successfully' })
  @ApiConflictResponse({ description: 'Tenant with this slug already exists' })
  createTenant(@Body() dto: CreateTenantDto) {
    return this.adminService.createTenant(dto);
  }

  @Get('users')
  @ApiOperation({ summary: 'Get users across all tenants (paginated, system admin only)' })
  @ApiOkResponse({ description: '{ data, total, limit, offset } — default 25 per page' })
  findAllUsers(@Query() pagination: PaginationQueryDto) {
    return this.adminService.findAllUsers(pagination);
  }

  @Patch('users/:id/deactivate')
  @ApiOperation({ summary: 'Deactivate a user account (system admin only)' })
  @ApiOkResponse({ description: 'User deactivated successfully' })
  @ApiNotFoundResponse({ description: 'User not found' })
  deactivateUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.deactivateUser(id);
  }

  @Get('dlq')
  @ApiOperation({
    summary: 'View permanently failed jobs across all queues (DLQ)',
    description: 'Shows jobs that exhausted all retry attempts across ai-recommendations, audit-events, and webhook-delivery queues.',
  })
  @ApiOkResponse({ description: 'Failed jobs, most recent first' })
  getDlq() {
    return this.dlqService.getFailedJobs();
  }

  @Post('dlq/retry')
  @ApiOperation({ summary: 'Retry a permanently failed job' })
  @ApiOkResponse({ description: 'Job re-queued' })
  retryDlqJob(@Query('queue') queue: string, @Query('jobId') jobId: string) {
    return this.dlqService.retryJob(queue, jobId);
  }
}
