import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { P2pReview } from './entities/p2p-review.entity';
import { P2pOrder } from '../p2p-orders/entities/p2p-order.entity';
import { P2pReviewsService } from './p2p-reviews.service';
import { P2pReviewsController } from './p2p-reviews.controller';

@Module({
  imports: [TypeOrmModule.forFeature([P2pReview, P2pOrder])],
  providers: [P2pReviewsService],
  controllers: [P2pReviewsController],
  exports: [P2pReviewsService],
})
export class P2pReviewsModule {}
