import Redis from 'ioredis';
export declare class AiRateLimiter {
    private readonly redis;
    constructor(redis: Redis);
    check(tenantId: string): Promise<{
        allowed: boolean;
        remaining: number;
        resetAt: Date;
    }>;
    assertAllowed(tenantId: string): Promise<void>;
    private atomicIncr;
}
