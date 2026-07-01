import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationEmailService } from './notification-email.service';
import { NotificationEventListener } from './notification-event.listener';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { Notification } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { User } from '../auth/entities/user.entity';
import { Tenant } from '../auth/entities/tenant.entity';
import { SellerProfile } from '../p2p-seller/entities/seller-profile.entity';
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, NotificationPreference, User, Tenant, SellerProfile]),
    UsageModule,
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationEmailService,
    NotificationEventListener,
    NotificationPreferencesService,
    NotificationDispatcherService,
  ],
  exports: [NotificationService, NotificationEmailService, NotificationPreferencesService],
})
export class NotificationsModule {}
