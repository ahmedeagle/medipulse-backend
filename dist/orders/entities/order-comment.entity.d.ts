export declare class OrderComment {
    id: string;
    orderId: string;
    authorId: string;
    authorRole: 'pharmacy_admin' | 'supplier_admin' | 'system_admin';
    authorName: string;
    body: string;
    isSystemMessage: boolean;
    createdAt: Date;
}
