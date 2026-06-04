import { IErpConnector } from './interfaces/erp-connector.interface';
import { IPosConnector } from './interfaces/pos-connector.interface';
import { ISupplierApiConnector } from './interfaces/supplier-api-connector.interface';
type AnyConnector = IErpConnector | IPosConnector | ISupplierApiConnector;
export declare class IntegrationRegistryService {
    private readonly logger;
    private readonly registry;
    register(tenantId: string, connector: AnyConnector): void;
    unregister(tenantId: string, type: AnyConnector['connectorType']): void;
    getErp(tenantId: string): IErpConnector | null;
    getPos(tenantId: string): IPosConnector | null;
    getSupplierApi(tenantId: string): ISupplierApiConnector | null;
    listRegistered(): Array<{
        tenantId: string;
        type: string;
    }>;
    private key;
}
export {};
