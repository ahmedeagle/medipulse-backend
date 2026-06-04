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
exports.AiRateLimiter = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = require("ioredis");
const redis_module_1 = require("../../common/redis/redis.module");
const HOURLY_LIMIT = 10;
const DAILY_LIMIT = 50;
let AiRateLimiter = class AiRateLimiter {
    constructor(redis) {
        this.redis = redis;
    }
    async check(tenantId) {
        const now = Date.now();
        const hourMs = 3_600;
        const dayMs = 86_400;
        const hourKey = `medipulse:ai:rl:${tenantId}:h`;
        const dayKey = `medipulse:ai:rl:${tenantId}:d`;
        const [hourlyCount, dailyCount] = await Promise.all([
            this.atomicIncr(hourKey, hourMs),
            this.atomicIncr(dayKey, dayMs),
        ]);
        if (hourlyCount > HOURLY_LIMIT) {
            const ttl = await this.redis.ttl(hourKey);
            return { allowed: false, remaining: 0, resetAt: new Date(now + ttl * 1_000) };
        }
        if (dailyCount > DAILY_LIMIT) {
            const ttl = await this.redis.ttl(dayKey);
            return { allowed: false, remaining: 0, resetAt: new Date(now + ttl * 1_000) };
        }
        return {
            allowed: true,
            remaining: Math.min(HOURLY_LIMIT - hourlyCount, DAILY_LIMIT - dailyCount),
            resetAt: new Date(now + hourMs * 1_000),
        };
    }
    async assertAllowed(tenantId) {
        const result = await this.check(tenantId);
        if (!result.allowed) {
            throw new common_1.HttpException(`AI generation rate limit exceeded. Resets at ${result.resetAt.toISOString()}.`, common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
    }
    async atomicIncr(key, ttlSeconds) {
        const count = await this.redis.incr(key);
        if (count === 1) {
            await this.redis.expire(key, ttlSeconds);
        }
        return count;
    }
};
exports.AiRateLimiter = AiRateLimiter;
exports.AiRateLimiter = AiRateLimiter = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(redis_module_1.REDIS_CLIENT)),
    __metadata("design:paramtypes", [ioredis_1.default])
], AiRateLimiter);
//# sourceMappingURL=rate-limiter.js.map