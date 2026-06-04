"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const order_workflow_service_1 = require("./order-workflow.service");
const compliance_workflow_service_1 = require("./compliance-workflow.service");
const order_return_request_entity_1 = require("../orders/entities/order-return-request.entity");
const order_comment_entity_1 = require("../orders/entities/order-comment.entity");
const ai_recommendation_entity_1 = require("../ai/entities/ai-recommendation.entity");
const product_batch_entity_1 = require("../inventory/entities/product-batch.entity");
const inventory_item_entity_1 = require("../inventory/entities/inventory-item.entity");
const user_entity_1 = require("../auth/entities/user.entity");
const notifications_module_1 = require("../notifications/notifications.module");
let WorkflowModule = class WorkflowModule {
};
exports.WorkflowModule = WorkflowModule;
exports.WorkflowModule = WorkflowModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                order_return_request_entity_1.OrderReturnRequest, order_comment_entity_1.OrderComment, ai_recommendation_entity_1.AiRecommendation,
                product_batch_entity_1.ProductBatch, inventory_item_entity_1.InventoryItem, user_entity_1.User,
            ]),
            notifications_module_1.NotificationsModule,
        ],
        providers: [order_workflow_service_1.OrderWorkflowService, compliance_workflow_service_1.ComplianceWorkflowService],
        exports: [order_workflow_service_1.OrderWorkflowService, compliance_workflow_service_1.ComplianceWorkflowService],
    })
], WorkflowModule);
//# sourceMappingURL=workflow.module.js.map