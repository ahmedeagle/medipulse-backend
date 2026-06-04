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
var AiGenerationProcessor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiGenerationProcessor = void 0;
const bullmq_1 = require("@nestjs/bullmq");
const common_1 = require("@nestjs/common");
const ai_service_1 = require("./ai.service");
const ai_constants_1 = require("./ai.constants");
let AiGenerationProcessor = AiGenerationProcessor_1 = class AiGenerationProcessor extends bullmq_1.WorkerHost {
    constructor(aiService) {
        super();
        this.aiService = aiService;
        this.logger = new common_1.Logger(AiGenerationProcessor_1.name);
    }
    async process(job) {
        const { tenantId, userId } = job.data;
        const attempt = job.attemptsMade + 1;
        this.logger.log(`[job:${job.id}] attempt ${attempt}: tenant ${tenantId}`);
        await job.updateProgress(10);
        const result = await this.aiService.runGeneration(tenantId, userId);
        await job.updateProgress(100);
        this.logger.log(`[job:${job.id}] done — ${result.length} recommendation(s)`);
        return result;
    }
    onFailed(job, err) {
        this.logger.error(`[job:${job.id}] failed (attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`);
    }
};
exports.AiGenerationProcessor = AiGenerationProcessor;
exports.AiGenerationProcessor = AiGenerationProcessor = AiGenerationProcessor_1 = __decorate([
    (0, bullmq_1.Processor)(ai_constants_1.AI_RECOMMENDATIONS_QUEUE, { concurrency: 5 }),
    __metadata("design:paramtypes", [ai_service_1.AiService])
], AiGenerationProcessor);
//# sourceMappingURL=ai-generation.processor.js.map