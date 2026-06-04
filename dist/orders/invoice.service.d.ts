import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { Invoice } from './entities/invoice.entity';
import { Order } from './entities/order.entity';
import { Tenant } from '../auth/entities/tenant.entity';
export declare class InvoiceService {
    private readonly invoiceRepo;
    private readonly orderRepo;
    private readonly tenantRepo;
    private readonly redis;
    private readonly logger;
    constructor(invoiceRepo: Repository<Invoice>, orderRepo: Repository<Order>, tenantRepo: Repository<Tenant>, redis: Redis);
    generateForOrder(orderId: string): Promise<Invoice>;
    findByOrder(orderId: string): Promise<Invoice | null>;
    private generateZatcaQrCode;
    private generateInvoiceNumber;
}
