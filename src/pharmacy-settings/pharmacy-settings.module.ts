import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PharmacySettings } from './entities/pharmacy-settings.entity';
import { Warehouse } from './entities/warehouse.entity';
import { PharmacySettingsService } from './pharmacy-settings.service';
import { PharmacySettingsController } from './pharmacy-settings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PharmacySettings, Warehouse])],
  controllers: [PharmacySettingsController],
  providers: [PharmacySettingsService],
  exports: [PharmacySettingsService],
})
export class PharmacySettingsModule {}
