/** CLI 智能体命令模板（纯函数，主进程与渲染层共用）。 */
export declare const CLI_PROMPT_COMMANDS: Record<string, string>;
export declare const CLI_PERMISSION_TIERS: string[];
export type CliPermissionTier = "safe" | "standard" | "full";
export declare function cliPromptCommand(bin: string): string;
export declare function cliPermissionTierOf(raw: unknown): CliPermissionTier;
export declare function cliSupportsPermissionTier(bin: string): boolean;
export declare function applyCliPermissionTier(template: string, tier: unknown): string;
export declare function cliPromptCommandFor(bin: string, tier?: unknown): string;
export declare function normalizeNoProxyList(value: unknown): string;
export declare function cliBinOf(template: string): string;
export declare function sanitizeCliPrompt(text: string): string;
export declare function fillCliPromptTemplate(template: string, prompt: string): string;
export declare function healCliCommand(template: string): string;
