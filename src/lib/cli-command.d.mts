/** CLI 智能体命令模板（纯函数，主进程与渲染层共用）。 */
export declare const CLI_PROMPT_COMMANDS: Record<string, string>;
export declare function cliPromptCommand(bin: string): string;
export declare function normalizeNoProxyList(value: unknown): string;
export declare function cliBinOf(template: string): string;
export declare function sanitizeCliPrompt(text: string): string;
export declare function fillCliPromptTemplate(template: string, prompt: string): string;
export declare function healCliCommand(template: string): string;
