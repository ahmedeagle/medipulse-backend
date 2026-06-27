import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { MigrationAssistantController } from './migration-assistant.controller';
import { MigrationAssistantService } from './migration-assistant.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [
    MulterModule.register({ limits: { fileSize: 15 * 1024 * 1024 } }),
    InventoryModule,
  ],
  controllers: [MigrationAssistantController],
  providers: [MigrationAssistantService],
})
export class MigrationAssistantModule {}
