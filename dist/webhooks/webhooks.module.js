"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhooksModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const bullmq_1 = require("@nestjs/bullmq");
const webhook_controller_1 = require("./webhook.controller");
const webhook_service_1 = require("./webhook.service");
const webhook_dispatch_listener_1 = require("./webhook-dispatch.listener");
const webhook_subscription_entity_1 = require("./entities/webhook-subscription.entity");
const webhook_delivery_entity_1 = require("./entities/webhook-delivery.entity");
const webhook_constants_1 = require("./webhook.constants");
let WebhooksModule = class WebhooksModule {
};
exports.WebhooksModule = WebhooksModule;
exports.WebhooksModule = WebhooksModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([webhook_subscription_entity_1.WebhookSubscription, webhook_delivery_entity_1.WebhookDelivery]),
            bullmq_1.BullModule.registerQueue({ name: webhook_constants_1.WEBHOOK_DELIVERY_QUEUE }),
        ],
        controllers: [webhook_controller_1.WebhookController],
        providers: [webhook_service_1.WebhookService, webhook_dispatch_listener_1.WebhookDispatchListener],
        exports: [webhook_service_1.WebhookService],
    })
], WebhooksModule);
//# sourceMappingURL=webhooks.module.js.map