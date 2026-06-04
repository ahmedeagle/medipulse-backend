import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationEmailService } from './notification-email.service';
import { NotificationEventListener } from './notification-event.listener';
import { Notification } from './entities/notification.entity';
import { User } from '../auth/entities/user.entity';
import { Tenant } from '../auth/entities/tenant.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, User, Tenant])],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationEmailService, NotificationEventListener],
  exports: [NotificationService, NotificationEmailService],
})
export class NotificationsModule {}
