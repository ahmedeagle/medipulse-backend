"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var DomainEventStoreListener_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomainEventStoreListener = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const domain_event_log_entity_1 = require("./entities/domain-event-log.entity");
let DomainEventStoreListener = DomainEventStoreListener_1 = class DomainEventStoreListener {
    constructor(emitter, repo) {
        this.emitter = emitter;
        this.repo = repo;
        this.logger = new common_1.Logger(DomainEventStoreListener_1.name);
    }
    onModuleInit() {
        this.emitter.onAny((eventName, payload) => {
            const name = Array.isArray(eventName) ? eventName.join('.') : eventName;
            if (!name.includes('.'))
                return;
            this.persist(name, payload).catch((err) => this.logger.error(`DomainEventLog write failed [${name}]: ${err.message}`));
        });
    }
    async persist(eventType, payload) {
        const safe = JSON.parse(JSON.stringify(payload ?? {}));
        await this.repo.save(this.repo.create({
            eventType,
            aggregateId: safe.orderId ?? safe.productId ?? safe.recommendationId ?? safe.catalogItemId ?? null,
            aggregateType: this.inferAggregateType(eventType),
            tenantId: safe.tenantId ?? safe.pharmacyTenantId ?? safe.supplierTenantId ?? null,
            payload: safe,
            correlationId: safe.correlationId ?? null,
        }));
    }
    inferAggregateType(eventType) {
        const prefix = eventType.split('.')[0];
        const map = {
            inventory: 'inventory',
            order: 'order',
            recommendation: 'recommendation',
            supplier: 'supplier_catalog',
            stock: 'inventory',
            ai: 'ai',
        };
        return map[prefix] ?? prefix;
    }
};
exports.DomainEventStoreListener = DomainEventStoreListener;
exports.DomainEventStoreListener = DomainEventStoreListener = DomainEventStoreListener_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, typeorm_1.InjectRepository)(domain_event_log_entity_1.DomainEventLog, 'audit')),
    __metadata("design:paramtypes", [event_emitter_1.EventEmitter2,
        typeorm_2.Repository])
], DomainEventStoreListener);
//# sourceMappingURL=domain-event-store.listener.js.map