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
exports.DlqService = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("bullmq");
const ai_constants_1 = require("../ai/ai.constants");
const audit_constants_1 = require("../audit/audit.constants");
const webhook_constants_1 = require("../webhooks/webhook.constants");
let DlqService = class DlqService {
    constructor(aiQueue, auditQueue, webhookQueue) {
        this.aiQueue = aiQueue;
        this.auditQueue = auditQueue;
        this.webhookQueue = webhookQueue;
    }
    async getFailedJobs() {
        const [aiFailed, auditFailed, webhookFailed] = await Promise.all([
            this.aiQueue.getFailed(0, 50),
            this.auditQueue.getFailed(0, 50),
            this.webhookQueue.getFailed(0, 50),
        ]);
        const toDto = (queue) => (job) => ({
            id: job.id,
            queue,
            name: job.name,
            data: job.data,
            failedReason: job.failedReason,
            attemptsMade: job.attemptsMade,
            finishedOn: job.finishedOn,
        });
        return [
            ...aiFailed.map(toDto(ai_constants_1.AI_RECOMMENDATIONS_QUEUE)),
            ...auditFailed.map(toDto(audit_constants_1.AUDIT_QUEUE)),
            ...webhookFailed.map(toDto(webhook_constants_1.WEBHOOK_DELIVERY_QUEUE)),
        ].sort((a, b) => (b.finishedOn ?? 0) - (a.finishedOn ?? 0));
    }
    async retryJob(queue, jobId) {
        const q = this.resolveQueue(queue);
        const job = await q.getJob(jobId);
        if (job)
            await job.retry();
    }
    resolveQueue(name) {
        if (name === ai_constants_1.AI_RECOMMENDATIONS_QUEUE)
            return this.aiQueue;
        if (name === audit_constants_1.AUDIT_QUEUE)
            return this.auditQueue;
        if (name === webhook_constants_1.WEBHOOK_DELIVERY_QUEUE)
            return this.webhookQueue;
        throw new Error(`Unknown queue: ${name}`);
    }
};
exports.DlqService = DlqService;
exports.DlqService = DlqService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, bullmq_1.InjectQueue)(ai_constants_1.AI_RECOMMENDATIONS_QUEUE)),
    __param(1, (0, bullmq_1.InjectQueue)(audit_constants_1.AUDIT_QUEUE)),
    __param(2, (0, bullmq_1.InjectQueue)(webhook_constants_1.WEBHOOK_DELIVERY_QUEUE)),
    __metadata("design:paramtypes", [bullmq_2.Queue,
        bullmq_2.Queue,
        bullmq_2.Queue])
], DlqService);
//# sourceMappingURL=dlq.service.js.map