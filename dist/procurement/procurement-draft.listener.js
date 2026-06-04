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
var ProcurementDraftListener_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcurementDraftListener = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const procurement_draft_service_1 = require("./procurement-draft.service");
const domain_events_1 = require("../events/domain-events");
let ProcurementDraftListener = ProcurementDraftListener_1 = class ProcurementDraftListener {
    constructor(draftService) {
        this.draftService = draftService;
        this.logger = new common_1.Logger(ProcurementDraftListener_1.name);
    }
    async onRecommendationGenerated(event) {
        if (event.riskLevel !== 'HIGH')
            return;
        try {
            const draft = await this.draftService.generateFromRecommendation(event.recommendationId, event.tenantId);
            if (draft) {
                this.logger.log(`Auto-draft created for pharmacy ${event.tenantId} → draft ${draft.id}`);
            }
        }
        catch (err) {
            this.logger.error(`Auto-draft failed for rec ${event.recommendationId}: ${err.message}`);
        }
    }
};
exports.ProcurementDraftListener = ProcurementDraftListener;
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.RECOMMENDATION_GENERATED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [domain_events_1.RecommendationGeneratedEvent]),
    __metadata("design:returntype", Promise)
], ProcurementDraftListener.prototype, "onRecommendationGenerated", null);
exports.ProcurementDraftListener = ProcurementDraftListener = ProcurementDraftListener_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [procurement_draft_service_1.ProcurementDraftService])
], ProcurementDraftListener);
//# sourceMappingURL=procurement-draft.listener.js.map