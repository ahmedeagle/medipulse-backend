import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { IntegrationRegistryService } from './integration-registry.service';
import { TenantIntegration } from './entities/tenant-integration.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TenantIntegration])],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationRegistryService],
  exports: [IntegrationsService, IntegrationRegistryService],
})
export class IntegrationsModule {}
