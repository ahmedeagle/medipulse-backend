import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { IsString, IsIn, IsOptional, IsUUID, IsDateString } from 'class-validator';
import { ProductRecallService, CreateRecallDto } from './product-recall.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { RecallType } from './entities/product-recall.entity';

class CreateRecallBodyDto {
  @IsUUID()
  productId: string;

  @IsOptional() @IsString()
  batchNumber?: string;

  @IsIn(['urgent', 'voluntary', 'market_withdrawal'])
  recallType: RecallType;

  @IsString()
  recallReferenceNumber: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsDateString()
  effectiveAt?: string;

  @IsOptional() @IsDateString()
  resolutionDeadline?: string;
}

@ApiTags('recalls')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/recalls')
export class ProductRecallController {
  constructor(private readonly recallSvc: ProductRecallService) {}

  @Get()
  @ApiOperation({ summary: 'List all product recalls (system admin)' })
  @ApiOkResponse()
  findAll() {
    return this.recallSvc.findAll();
  }

  @Post()
  @ApiOperation({
    summary: 'Issue a product recall (SFDA notice)',
    description:
      'Creates recall record, marks all affected ProductBatch records as recalled, ' +
      'and immediately notifies all pharmacies holding the affected product/batch via ' +
      'in-app notification and email.',
  })
  @ApiCreatedResponse()
  create(@CurrentUser() user: any, @Body() dto: CreateRecallBodyDto) {
    const recallDto: CreateRecallDto = {
      productId:             dto.productId,
      batchNumber:           dto.batchNumber,
      recallType:            dto.recallType,
      recallReferenceNumber: dto.recallReferenceNumber,
      description:           dto.description,
      effectiveAt:           dto.effectiveAt ? new Date(dto.effectiveAt) : undefined,
      resolutionDeadline:    dto.resolutionDeadline ? new Date(dto.resolutionDeadline) : undefined,
      createdByUserId:       user.id,
    };
    return this.recallSvc.create(recallDto);
  }

  @Patch(':id/resolve')
  @ApiOperation({ summary: 'Mark a recall as resolved' })
  @ApiOkResponse()
  resolve(@Param('id', ParseUUIDPipe) id: string) {
    return this.recallSvc.resolve(id);
  }
}
