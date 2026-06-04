"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhooksWorkerModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const bullmq_1 = require("@nestjs/bullmq");
const webhook_delivery_processor_1 = require("./webhook-delivery.processor");
const webhook_subscription_entity_1 = require("./entities/webhook-subscription.entity");
const webhook_delivery_entity_1 = require("./entities/webhook-delivery.entity");
const webhook_constants_1 = require("./webhook.constants");
let WebhooksWorkerModule = class WebhooksWorkerModule {
};
exports.WebhooksWorkerModule = WebhooksWorkerModule;
exports.WebhooksWorkerModule = WebhooksWorkerModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([webhook_subscription_entity_1.WebhookSubscription, webhook_delivery_entity_1.WebhookDelivery]),
            bullmq_1.BullModule.registerQueue({ name: webhook_constants_1.WEBHOOK_DELIVERY_QUEUE }),
        ],
        providers: [webhook_delivery_processor_1.WebhookDeliveryProcessor],
    })
], WebhooksWorkerModule);
//# sourceMappingURL=webhooks-worker.module.js.map