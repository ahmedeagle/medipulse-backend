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
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("bullmq");
const crypto_1 = require("crypto");
const webhook_subscription_entity_1 = require("./entities/webhook-subscription.entity");
const webhook_delivery_entity_1 = require("./entities/webhook-delivery.entity");
const webhook_constants_1 = require("./webhook.constants");
const domain_events_1 = require("../events/domain-events");
const VALID_EVENTS = new Set(Object.values(domain_events_1.EVENTS));
let WebhookService = class WebhookService {
    constructor(subRepo, deliveryRepo, deliveryQueue) {
        this.subRepo = subRepo;
        this.deliveryRepo = deliveryRepo;
        this.deliveryQueue = deliveryQueue;
    }
    async create(tenantId, dto) {
        this.validateEvents(dto.events);
        const secret = (0, crypto_1.randomBytes)(32).toString('hex');
        const sub = this.subRepo.create({ tenantId, url: dto.url, events: dto.events, secret });
        return this.subRepo.save(sub);
    }
    async list(tenantId) {
        return this.subRepo.find({
            where: { tenantId },
            order: { createdAt: 'DESC' },
        });
    }
    async remove(tenantId, id) {
        const sub = await this.findOwned(tenantId, id);
        await this.subRepo.remove(sub);
    }
    async listDeliveries(tenantId, id) {
        await this.findOwned(tenantId, id);
        return this.deliveryRepo.find({
            where: { subscriptionId: id },
            order: { createdAt: 'DESC' },
            take: 100,
        });
    }
    async sendTestEvent(tenantId, id) {
        const sub = await this.findOwned(tenantId, id);
        const payload = {
            event: 'webhook.test',
            timestamp: new Date().toISOString(),
            tenantId,
            data: { message: 'MediPulse webhook test — your endpoint is configured correctly.' },
        };
        const job = await this.enqueueDelivery(sub, 'webhook.test', payload);
        return { jobId: job.id };
    }
    async dispatchEvent(eventType, data) {
        const subs = await this.subRepo
            .createQueryBuilder('s')
            .where('s.isActive = true')
            .andWhere('s.requiresAttention = false')
            .andWhere(':eventType = ANY(s.events)', { eventType })
            .getMany();
        if (!subs.length)
            return;
        const payload = {
            event: eventType,
            timestamp: new Date().toISOString(),
            data,
        };
        await Promise.all(subs.map((sub) => this.enqueueDelivery(sub, eventType, payload)));
    }
    async enqueueDelivery(sub, eventType, payload) {
        const signature = this.sign(sub.secret, JSON.stringify(payload));
        return this.deliveryQueue.add(webhook_constants_1.WEBHOOK_DELIVER_JOB, { subscriptionId: sub.id, url: sub.url, payload, signature, eventType }, { attempts: 5, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: { age: 86_400 }, removeOnFail: { age: 604_800 } });
    }
    sign(secret, body) {
        return 't=' + Date.now() + ',v1=' + (0, crypto_1.createHmac)('sha256', secret).update(body).digest('hex');
    }
    validateEvents(events) {
        const invalid = events.filter((e) => !VALID_EVENTS.has(e));
        if (invalid.length) {
            throw new common_1.BadRequestException(`Unknown event types: ${invalid.join(', ')}. Valid: ${[...VALID_EVENTS].join(', ')}`);
        }
    }
    async findOwned(tenantId, id) {
        const sub = await this.subRepo.findOne({ where: { id } });
        if (!sub)
            throw new common_1.NotFoundException(`Webhook subscription ${id} not found`);
        if (sub.tenantId !== tenantId)
            throw new common_1.ForbiddenException('Access denied');
        return sub;
    }
};
exports.WebhookService = WebhookService;
exports.WebhookService = WebhookService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(webhook_subscription_entity_1.WebhookSubscription)),
    __param(1, (0, typeorm_1.InjectRepository)(webhook_delivery_entity_1.WebhookDelivery)),
    __param(2, (0, bullmq_1.InjectQueue)(webhook_constants_1.WEBHOOK_DELIVERY_QUEUE)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        bullmq_2.Queue])
], WebhookService);
//# sourceMappingURL=webhook.service.js.map