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
var WebhookDeliveryProcessor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookDeliveryProcessor = void 0;
const bullmq_1 = require("@nestjs/bullmq");
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const axios_1 = require("axios");
const webhook_delivery_entity_1 = require("./entities/webhook-delivery.entity");
const webhook_subscription_entity_1 = require("./entities/webhook-subscription.entity");
const webhook_constants_1 = require("./webhook.constants");
let WebhookDeliveryProcessor = WebhookDeliveryProcessor_1 = class WebhookDeliveryProcessor extends bullmq_1.WorkerHost {
    constructor(deliveryRepo, subRepo) {
        super();
        this.deliveryRepo = deliveryRepo;
        this.subRepo = subRepo;
        this.logger = new common_1.Logger(WebhookDeliveryProcessor_1.name);
    }
    async process(job) {
        const { subscriptionId, url, payload, signature, eventType } = job.data;
        const body = JSON.stringify(payload);
        let statusCode = null;
        let error = null;
        try {
            const response = await axios_1.default.post(url, body, {
                timeout: 10_000,
                headers: {
                    'Content-Type': 'application/json',
                    'X-MediPulse-Signature': signature,
                    'X-MediPulse-Event': eventType,
                    'User-Agent': 'MediPulse-Webhooks/1.0',
                },
                validateStatus: () => true,
            });
            statusCode = response.status;
            if (response.status >= 400) {
                throw new Error(`Subscriber returned HTTP ${response.status}`);
            }
        }
        catch (err) {
            error = err.message;
            throw err;
        }
        finally {
            await this.deliveryRepo.save(this.deliveryRepo.create({
                subscriptionId,
                eventType,
                payload,
                statusCode,
                attemptCount: job.attemptsMade + 1,
                lastAttemptAt: new Date(),
                deliveredAt: statusCode && statusCode < 400 ? new Date() : null,
                error,
            }));
        }
        this.logger.log(`[webhook] Delivered ${eventType} to ${url} — ${statusCode}`);
    }
    async onFailed(job, err) {
        if (job.attemptsMade >= (job.opts.attempts ?? 5) - 1) {
            this.logger.warn(`[webhook] subscription ${job.data.subscriptionId} flagged — too many failures`);
            await this.subRepo.update(job.data.subscriptionId, { requiresAttention: true });
        }
    }
};
exports.WebhookDeliveryProcessor = WebhookDeliveryProcessor;
exports.WebhookDeliveryProcessor = WebhookDeliveryProcessor = WebhookDeliveryProcessor_1 = __decorate([
    (0, bullmq_1.Processor)(webhook_constants_1.WEBHOOK_DELIVERY_QUEUE, { concurrency: 10 }),
    __param(0, (0, typeorm_1.InjectRepository)(webhook_delivery_entity_1.WebhookDelivery)),
    __param(1, (0, typeorm_1.InjectRepository)(webhook_subscription_entity_1.WebhookSubscription)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository])
], WebhookDeliveryProcessor);
//# sourceMappingURL=webhook-delivery.processor.js.map