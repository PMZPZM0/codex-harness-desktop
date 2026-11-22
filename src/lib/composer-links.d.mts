/** 输入框链接识别（.mjs）的类型声明；⛔ 与 .mjs 导出保持同步。 */
export declare const HTTP_URL_RE: RegExp;
export declare function sanitizeHttpUrl(value: unknown): string;
export declare function decodePercentText(value: unknown): string;
export declare function extractHttpUrls(text: unknown): string[];
export declare function isGithubUrl(url: string): boolean;
export declare function githubLinkLabel(url: string): string;
