"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var IntegrationRegistryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationRegistryService = void 0;
const common_1 = require("@nestjs/common");
let IntegrationRegistryService = IntegrationRegistryService_1 = class IntegrationRegistryService {
    constructor() {
        this.logger = new common_1.Logger(IntegrationRegistryService_1.name);
        this.registry = new Map();
    }
    register(tenantId, connector) {
        const key = this.key(tenantId, connector.connectorType);
        this.registry.set(key, connector);
        this.logger.log(`Registered ${connector.connectorType} connector for tenant ${tenantId}`);
    }
    unregister(tenantId, type) {
        this.registry.delete(this.key(tenantId, type));
    }
    getErp(tenantId) {
        return this.registry.get(this.key(tenantId, 'erp')) ?? null;
    }
    getPos(tenantId) {
        return this.registry.get(this.key(tenantId, 'pos')) ?? null;
    }
    getSupplierApi(tenantId) {
        return this.registry.get(this.key(tenantId, 'supplier_api')) ?? null;
    }
    listRegistered() {
        return Array.from(this.registry.keys()).map((k) => {
            const [tenantId, type] = k.split(':');
            return { tenantId, type };
        });
    }
    key(tenantId, type) {
        return `${tenantId}:${type}`;
    }
};
exports.IntegrationRegistryService = IntegrationRegistryService;
exports.IntegrationRegistryService = IntegrationRegistryService = IntegrationRegistryService_1 = __decorate([
    (0, common_1.Injectable)()
], IntegrationRegistryService);
//# sourceMappingURL=integration-registry.service.js.map