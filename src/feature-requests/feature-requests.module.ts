import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FeatureRequest }           from './entities/feature-request.entity';
import { FeatureRequestsService }   from './feature-requests.service';
import { FeatureRequestsController } from './feature-requests.controller';
import { NotificationsModule }       from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FeatureRequest]),
    NotificationsModule,
  ],
  providers:   [FeatureRequestsService],
  controllers: [FeatureRequestsController],
  exports:     [FeatureRequestsService],
})
export class FeatureRequestsModule {}
