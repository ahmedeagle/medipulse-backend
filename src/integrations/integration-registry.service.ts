import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IErpConnector } from './interfaces/erp-connector.interface';
import { IPosConnector } from './interfaces/pos-connector.interface';
import { ISupplierApiConnector } from './interfaces/supplier-api-connector.interface';

type AnyConnector = IErpConnector | IPosConnector | ISupplierApiConnector;

/**
 * Central registry for all integration connectors.
 *
 * Design intent: connectors register themselves at module load via NestJS DI.
 * The registry provides a type-safe lookup for services that need to trigger
 * external system calls (e.g. procurement service calling ERP to push an order).
 *
 * Usage (when a real connector is built):
 *   @Injectable()
 *   class SapB1Connector implements IErpConnector {
 *     readonly connectorType = 'erp' as const;
 *     // ... implement methods
 *   }
 *
 *   // In the connector's module:
 *   export class SapModule implements OnModuleInit {
 *     constructor(private registry: IntegrationRegistryService, private sap: SapB1Connector) {}
 *     onModuleInit() { this.registry.register('tenant-uuid', this.sap); }
 *   }
 */
@Injectable()
export class IntegrationRegistryService {
  private readonly logger = new Logger(IntegrationRegistryService.name);

  /** Map key: `${tenantId}:${connectorType}` */
  private readonly registry = new Map<string, AnyConnector>();

  register(tenantId: string, connector: AnyConnector): void {
    const key = this.key(tenantId, connector.connectorType);
    this.registry.set(key, connector);
    this.logger.log(`Registered ${connector.connectorType} connector for tenant ${tenantId}`);
  }

  unregister(tenantId: string, type: AnyConnector['connectorType']): void {
    this.registry.delete(this.key(tenantId, type));
  }

  getErp(tenantId: string): IErpConnector | null {
    return (this.registry.get(this.key(tenantId, 'erp')) as IErpConnector) ?? null;
  }

  getPos(tenantId: string): IPosConnector | null {
    return (this.registry.get(this.key(tenantId, 'pos')) as IPosConnector) ?? null;
  }

  getSupplierApi(tenantId: string): ISupplierApiConnector | null {
    return (this.registry.get(this.key(tenantId, 'supplier_api')) as ISupplierApiConnector) ?? null;
  }

  listRegistered(): Array<{ tenantId: string; type: string }> {
    return Array.from(this.registry.keys()).map((k) => {
      const [tenantId, type] = k.split(':');
      return { tenantId, type };
    });
  }

  private key(tenantId: string, type: string): string {
    return `${tenantId}:${type}`;
  }
}
