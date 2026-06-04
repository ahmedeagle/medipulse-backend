import { ConfigService } from '@nestjs/config';
export declare class NotificationEmailService {
    private readonly config;
    private readonly logger;
    private transporter;
    private readonly fromAddress;
    private readonly isProd;
    constructor(config: ConfigService);
    send(to: string, subject: string, html: string): Promise<void>;
    buildHighRiskStockout(productName: string, stockDays: number, tenantName: string): {
        subject: string;
        html: string;
    };
    buildOrderStatusChanged(orderId: string, status: string, productSummary: string, isSupplier: boolean): {
        subject: string;
        html: string;
    };
    buildDeliveryConfirmed(orderRef: string, tenantName: string): {
        subject: string;
        html: string;
    };
    buildDraftCreated(productName: string, qty: number, supplierName: string): {
        subject: string;
        html: string;
    };
    buildReorderDeadline(productName: string, daysLeft: number): {
        subject: string;
        html: string;
    };
    private wrap;
    private btnStyle;
    private appUrl;
}
