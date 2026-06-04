import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

/**
 * Global event bus using EventEmitter2 with wildcard support.
 * Import once in AppModule — NestJS makes it globally available.
 *
 * Emit:   this.eventEmitter.emit(EVENTS.INVENTORY_UPDATED, new InventoryUpdatedEvent(...))
 * Listen: @OnEvent(EVENTS.INVENTORY_UPDATED)
 */
@Module({
  imports: [
    EventEmitterModule.forRoot({
      wildcard: true,       // supports 'inventory.*' patterns in @OnEvent()
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),
  ],
})
export class EventsModule {}
