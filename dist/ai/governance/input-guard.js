"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InputGuard = void 0;
const common_1 = require("@nestjs/common");
const logger = new common_1.Logger('InputGuard');
const INJECTION_PATTERNS = [
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
const MAX_FIELD_LENGTH = 500;
class InputGuard {
    validate(prompt) {
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
    sanitizeField(value, fieldName) {
        if (!value)
            return '';
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
    assertSafe(prompt) {
        const result = this.validate(prompt);
        if (!result.safe) {
            throw new common_1.BadRequestException(`AI input validation failed: ${result.reason}`);
        }
    }
}
exports.InputGuard = InputGuard;
//# sourceMappingURL=input-guard.js.map