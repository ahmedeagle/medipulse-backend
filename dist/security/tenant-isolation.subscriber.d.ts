import { EntitySubscriberInterface, InsertEvent, UpdateEvent, RemoveEvent } from 'typeorm';
export declare class TenantIsolationSubscriber implements EntitySubscriberInterface {
    private readonly logger;
    private readonly TENANT_SCOPED_ENTITIES;
    private isTenantScoped;
    afterInsert(event: InsertEvent<any>): void;
    afterUpdate(event: UpdateEvent<any>): void;
    afterRemove(event: RemoveEvent<any>): void;
}
