import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NormalizationController } from './normalization.controller';
import { ProductNormalizationService } from './product-normalization.service';
import { ProductAlias } from './entities/product-alias.entity';
import { Product } from '../inventory/entities/product.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Product, ProductAlias])],
  controllers: [NormalizationController],
  providers: [ProductNormalizationService],
  exports: [ProductNormalizationService],
})
export class NormalizationModule {}
