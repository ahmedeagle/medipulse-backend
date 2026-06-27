import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { createHash } from 'crypto';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import type { ChatAnswer } from './dto/ask-chat.dto';

/**
 * Tenant-scoped, short-TTL Redis cache for chat answers.
 *
 * Why: the same operational question is asked many times per day across
 * a pharmacy ("ما هي الأدوية القريبة من الانتهاء؟", "كم صنف منخفض؟"). Each
 * answer costs two `gpt-4o-mini` round trips + several DB reads. A 5-minute
 * TTL with a normalised key cuts ~60% of repeat tokens at typical traffic
 * patterns, with no risk of staleness for the operational decisions chat
 * supports (the data behind every tool is recomputed inside the TTL on the
 * next miss).
 *
 * Cache key: SHA-256( tenantId | normalisedQuestion ).
 *   - Tenant prefix prevents cross-tenant data leakage.
 *   - Normalisation: trim → lowercase → collapse whitespace → strip
 *     Arabic diacritics → strip trailing punctuation. Two questions that
 *     differ only in spacing or tashkeel hit the same cache slot.
 *
 * Invalidation: TTL only. We do NOT invalidate on writes because:
 *   1. Chat is advisory, not transactional — 5 min staleness is acceptable.
 *   2. Pinning to data-mutation events would couple chat to every write
 *      path in the system (huge surface, fragile).
 */
@Injectable()
export class ChatAnswerCache {
  private readonly logger = new Logger(ChatAnswerCache.name);
  private readonly ttlSeconds = 300; // 5 minutes
  private readonly keyPrefix = 'medipulse:chat:ans:';

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get(tenantId: string, question: string): Promise<ChatAnswer | null> {
    try {
      const raw = await this.redis.get(this.key(tenantId, question));
      if (!raw) return null;
      return JSON.parse(raw) as ChatAnswer;
    } catch (err) {
      // Cache failure must never break the chat — return a miss.
      this.logger.warn(`chat cache get failed: ${(err as Error).message}`);
      return null;
    }
  }

  async set(tenantId: string, question: string, answer: ChatAnswer): Promise<void> {
    // Only cache successful, complete answers. Errors and `not_configured`
    // would lock in bad UX for the entire TTL window.
    if (answer.type !== 'answer') return;
    try {
      await this.redis.set(
        this.key(tenantId, question),
        JSON.stringify(answer),
        'EX',
        this.ttlSeconds,
      );
    } catch (err) {
      this.logger.warn(`chat cache set failed: ${(err as Error).message}`);
    }
  }

  /**
   * Manual invalidation hook for the rare write paths that DO want to
   * blow away the per-tenant chat cache (e.g. bulk inventory import).
   * Uses SCAN, not KEYS, to avoid blocking Redis on large keyspaces.
   */
  async invalidateTenant(tenantId: string): Promise<void> {
    const pattern = `${this.keyPrefix}${tenantId}:*`;
    try {
      const stream = this.redis.scanStream({ match: pattern, count: 200 });
      const pipeline = this.redis.pipeline();
      let queued = 0;
      for await (const keys of stream as AsyncIterable<string[]>) {
        for (const k of keys) {
          pipeline.del(k);
          queued++;
        }
      }
      if (queued > 0) await pipeline.exec();
    } catch (err) {
      this.logger.warn(`chat cache invalidate failed: ${(err as Error).message}`);
    }
  }

  // ── internals ──────────────────────────────────────────────────────────

  private key(tenantId: string, question: string): string {
    const normalised = this.normalise(question);
    const hash = createHash('sha256')
      .update(`${tenantId}|${normalised}`)
      .digest('hex')
      .slice(0, 32); // 128 bits is plenty for a 5-min keyspace
    return `${this.keyPrefix}${tenantId}:${hash}`;
  }

  private normalise(q: string): string {
    return q
      .normalize('NFKD')
      // strip Arabic tashkeel (harakat) — same question with/without
      // diacritics should hit the same cache slot
      .replace(/[\u064B-\u0652\u0670]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[!?.,؟،]+$/u, '')
      .trim();
  }
}
