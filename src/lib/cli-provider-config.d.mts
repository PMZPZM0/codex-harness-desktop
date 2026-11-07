/** CLI 智能体「跟随主会话供应商/模型」的配置生成（纯函数，主进程与渲染层共用）。 */
export declare function isLocalBaseUrl(raw: unknown): boolean;
export declare function stripV1Suffix(baseUrl: unknown): string;
export declare function kimiConfigToml(input: { baseUrl?: string; model?: string; apiKey?: string }): string;
export declare function codexConfigToml(input: { baseUrl?: string; model?: string }): string;
export declare function mergeGeminiSettings(raw: unknown, input: { model?: string }): Record<string, unknown>;
