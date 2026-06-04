export interface InputGuardResult {
    safe: boolean;
    reason?: string;
}
export declare class InputGuard {
    validate(prompt: string): InputGuardResult;
    sanitizeField(value: string, fieldName: string): string;
    assertSafe(prompt: string): void;
}
