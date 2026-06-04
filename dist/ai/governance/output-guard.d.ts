export interface OutputGuardResult {
    safe: boolean;
    reason?: string;
    sanitized?: string;
}
export declare class OutputGuard {
    validate(output: string): OutputGuardResult;
    assertSafe(output: string): string;
    private truncateAtSentence;
}
