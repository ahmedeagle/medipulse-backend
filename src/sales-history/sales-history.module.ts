import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { SalesHistoryController } from './sales-history.controller';
import { SalesHistoryService } from './sales-history.service';
import { SalesHistoryUpload } from './entities/sales-history-upload.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SalesHistoryUpload]),
    MulterModule.register({ limits: { fileSize: 15 * 1024 * 1024 } }),
    NotificationsModule,
  ],
  controllers: [SalesHistoryController],
  providers: [SalesHistoryService],
  exports: [SalesHistoryService],
})
export class SalesHistoryModule {}
