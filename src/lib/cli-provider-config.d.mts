/** CLI 智能体「跟随主会话供应商/模型」的配置生成（纯函数，主进程与渲染层共用）。 */
export declare function isLocalBaseUrl(raw: unknown): boolean;
export declare function stripV1Suffix(baseUrl: unknown): string;
/** kimi provider 读取 API Key 的环境变量名（Key 不落盘）。 */
export declare const CLI_KEY_ENV: string;
export declare function kimiConfigToml(input: { baseUrl?: string; model?: string; apiKey?: string; apiKeyEnv?: string }): string;
/** iFlow CLI 的 ~/.iflow/settings.json（selectedAuthType + apiKey/baseUrl/modelName，字段不齐返回空串）。 */
export declare function iflowSettingsJson(raw: unknown, input: { baseUrl?: string; model?: string; apiKey?: string }): string;
export declare function codexConfigToml(input: { baseUrl?: string; model?: string }): string;
export declare function mergeGeminiSettings(raw: unknown, input: { model?: string }): Record<string, unknown>;
/** CLI 的模型协议族：anthropic（Claude Code）/ gemini（Gemini、Qwen Code、iFlow）/ native（Kimi、Codex）/ openai（其余）。 */
export declare function cliProtocolOf(bin: unknown): "anthropic" | "gemini" | "native" | "openai";
