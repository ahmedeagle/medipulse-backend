import { BadRequestException, Logger } from '@nestjs/common';

const logger = new Logger('InputGuard');

/**
 * Patterns that indicate prompt injection attempts.
 * Checked against any user-derived string before it reaches GPT.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(previous|above|prior|all)\s+(instructions?|prompts?|rules?)/i,
  /you\s+are\s+now/i,
  /act\s+as\s+(a\s+)?(?!pharmacy)/i,
  /forget\s+(your\s+)?(previous\s+)?(instructions?|rules?|constraints?)/i,
  /jailbreak/i,
  /DAN\s*mode/i,
  /system\s*prompt/i,
  /reveal\s+your\s+(instructions?|prompt|system)/i,
  /<\s*script/i,
  /\bexec\s*\(/i,
  /\beval\s*\(/i,
];

/**
 * Max character length for any single string field sent to GPT.
 * Prevents context stuffing.
 */
const MAX_FIELD_LENGTH = 500;

export interface InputGuardResult {
  safe: boolean;
  reason?: string;
}

export class InputGuard {
  /**
   * Validates the structured prompt string before it is sent to OpenAI.
   * The prompt is assembled by our code from rule engine output — not from
   * raw user text — but we still guard it as defense-in-depth in case
   * product names or notes are injected through supplier/inventory data.
   */
  validate(prompt: string): InputGuardResult {
    if (!prompt || typeof prompt !== 'string') {
      return { safe: false, reason: 'empty_prompt' };
    }

    if (prompt.length > MAX_FIELD_LENGTH * 10) {
      logger.warn(`InputGuard: prompt length ${prompt.length} exceeds limit`);
      return { safe: false, reason: 'prompt_too_long' };
    }

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(prompt)) {
        logger.warn(`InputGuard: injection pattern matched — ${pattern.source}`);
        return { safe: false, reason: `injection_pattern: ${pattern.source}` };
      }
    }

    return { safe: true };
  }

  /**
   * Validates a single user-supplied string field (product name, notes, etc.)
   * that may end up embedded in a prompt.
   */
  sanitizeField(value: string, fieldName: string): string {
    if (!value) return '';

    if (value.length > MAX_FIELD_LENGTH) {
      logger.warn(`InputGuard: field "${fieldName}" truncated from ${value.length} chars`);
      return value.slice(0, MAX_FIELD_LENGTH);
    }

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(value)) {
        logger.warn(`InputGuard: injection in field "${fieldName}" — replaced`);
        return '[invalid input]';
      }
    }

    return value;
  }

  assertSafe(prompt: string): void {
    const result = this.validate(prompt);
    if (!result.safe) {
      throw new BadRequestException(`AI input validation failed: ${result.reason}`);
    }
  }
}
