"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutputGuard = void 0;
const common_1 = require("@nestjs/common");
const logger = new common_1.Logger('OutputGuard');
const OUT_OF_SCOPE_PATTERNS = [
    /\b(dose|dosage|dosing|mg\s*per\s*kg|mg\/kg)\b/i,
    /\b(prescribe|prescription|prescribed)\b/i,
    /\b(side\s*effect|adverse\s*effect|contraindication)\b/i,
    /\b(patient|diagnosis|diagnose|symptom|treatment|therapy|clinical)\b/i,
    /\b(consult\s+(a\s+)?(doctor|physician|pharmacist|healthcare))\b/i,
];
const PERSONA_BREAK_PATTERNS = [
    /as an ai/i,
    /i('m|\s+am)\s+(an?\s+)?(ai|language model|llm)/i,
    /openai/i,
    /gpt/i,
    /anthropic/i,
    /system prompt/i,
    /my instructions/i,
];
const MIN_LENGTH = 10;
const MAX_LENGTH = 400;
class OutputGuard {
    validate(output) {
        if (!output || typeof output !== 'string') {
            return { safe: false, reason: 'empty_output' };
        }
        const trimmed = output.trim();
        if (trimmed.length < MIN_LENGTH) {
            return { safe: false, reason: 'output_too_short' };
        }
        if (trimmed.length > MAX_LENGTH) {
            logger.warn(`OutputGuard: output truncated from ${trimmed.length} chars`);
            const truncated = this.truncateAtSentence(trimmed, MAX_LENGTH);
            return this.validate(truncated);
        }
        for (const pattern of OUT_OF_SCOPE_PATTERNS) {
            if (pattern.test(trimmed)) {
                logger.warn(`OutputGuard: out-of-scope content — ${pattern.source}`);
                return { safe: false, reason: `out_of_scope: ${pattern.source}` };
            }
        }
        for (const pattern of PERSONA_BREAK_PATTERNS) {
            if (pattern.test(trimmed)) {
                logger.warn(`OutputGuard: persona break detected — ${pattern.source}`);
                return { safe: false, reason: `persona_break: ${pattern.source}` };
            }
        }
        return { safe: true, sanitized: trimmed };
    }
    assertSafe(output) {
        const result = this.validate(output);
        if (!result.safe || !result.sanitized) {
            return null;
        }
        return result.sanitized;
    }
    truncateAtSentence(text, maxLen) {
        const chunk = text.slice(0, maxLen);
        const lastPeriod = chunk.lastIndexOf('.');
        return lastPeriod > maxLen * 0.5 ? chunk.slice(0, lastPeriod + 1) : chunk;
    }
}
exports.OutputGuard = OutputGuard;
//# sourceMappingURL=output-guard.js.map