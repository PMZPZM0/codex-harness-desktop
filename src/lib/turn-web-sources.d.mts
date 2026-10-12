/**
 * 回合网页来源提取（类型面；实现见 ./turn-web-sources.mjs）。
 */
export declare function collectTurnWebSources(turn: { items?: Array<{ type: string; [key: string]: unknown }> } | null | undefined): Array<{ url: string; host: string }>;
