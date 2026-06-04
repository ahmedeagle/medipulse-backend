export declare const CURRENT_PROMPT_VERSION = "v1.2";
export declare const SYSTEM_PROMPTS: Record<string, string>;
export declare function getSystemPrompt(key: keyof typeof SYSTEM_PROMPTS): string;
