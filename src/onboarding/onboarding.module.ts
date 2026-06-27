import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { ConsumptionSnapshot } from '../inventory/entities/consumption-snapshot.entity';
import { Tenant } from '../auth/entities/tenant.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ConsumptionSnapshot, Tenant])],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
