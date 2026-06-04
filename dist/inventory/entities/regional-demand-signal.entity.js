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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegionalDemandSignal = void 0;
const typeorm_1 = require("typeorm");
let RegionalDemandSignal = class RegionalDemandSignal {
};
exports.RegionalDemandSignal = RegionalDemandSignal;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], RegionalDemandSignal.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], RegionalDemandSignal.prototype, "productId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 100 }),
    __metadata("design:type", String)
], RegionalDemandSignal.prototype, "region", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], RegionalDemandSignal.prototype, "month", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 3, default: 1.0 }),
    __metadata("design:type", Number)
], RegionalDemandSignal.prototype, "demandMultiplier", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20, default: 'manual' }),
    __metadata("design:type", String)
], RegionalDemandSignal.prototype, "source", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], RegionalDemandSignal.prototype, "notes", void 0);
exports.RegionalDemandSignal = RegionalDemandSignal = __decorate([
    (0, typeorm_1.Entity)('regional_demand_signals'),
    (0, typeorm_1.Index)(['productId', 'region', 'month'], { unique: true })
], RegionalDemandSignal);
//# sourceMappingURL=regional-demand-signal.entity.js.map