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
} from '@nestjs/swagger';
import { IsString, IsIn, IsOptional, IsObject } from 'class-validator';
import { IntegrationsService } from './integrations.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { IntegrationType } from './entities/tenant-integration.entity';

class CreateIntegrationDto {
  @IsString()
  tenantId: string;

  @IsIn(['erp', 'pos', 'supplier_api'])
  type: IntegrationType;

  @IsString()
  connectorId: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;

  @IsOptional()
  @IsString()
  secretsArn?: string;
}

@ApiTags('integrations')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly svc: IntegrationsService) {}

  @Post()
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'Register a new integration for a tenant (system admin)' })
  @ApiCreatedResponse()
  create(@Body() dto: CreateIntegrationDto) {
    return this.svc.create(dto);
  }

  @Get()
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'List all tenant integrations (system admin)' })
  @ApiOkResponse()
  findAll() {
    return this.svc.findAll();
  }

  @Get('mine')
  @Roles(Role.PHARMACY_ADMIN, Role.SUPPLIER_ADMIN)
  @ApiOperation({ summary: 'List integrations for the requesting tenant' })
  @ApiOkResponse()
  findMine(@CurrentUser() user: any) {
    return this.svc.findAllForTenant(user.tenantId);
  }

  @Get('connectors/active')
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'List currently active in-memory connectors' })
  @ApiOkResponse()
  listActiveConnectors() {
    return this.svc.listActiveConnectors();
  }

  @Patch(':id/enable')
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'Enable an integration' })
  @ApiOkResponse()
  enable(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.toggle(id, 'active');
  }

  @Patch(':id/disable')
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'Disable an integration' })
  @ApiOkResponse()
  disable(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.toggle(id, 'inactive');
  }

  @Delete(':id')
  @Roles(Role.SYSTEM_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an integration and unregister its connector' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id);
  }
}
