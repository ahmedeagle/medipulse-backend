import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { P2pListing } from './entities/p2p-listing.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { P2pListingService } from './p2p-listing.service';
import { P2pListingController } from './p2p-listing.controller';

@Module({
  imports: [TypeOrmModule.forFeature([P2pListing, InventoryItem])],
  controllers: [P2pListingController],
  providers: [P2pListingService],
  exports: [P2pListingService],
})
export class P2pListingModule {}
