/** 类型声明（与 voice-auto-speak.mjs 一一对应；.mjs 侧是真身，类型只在这里声明）。 */

/** ① 工具调用次数上限：超过就强制播报。 */
export declare const AUTO_TOOL_CALL_LIMIT: number;
/** ② 返工判定：同一个签名出现 ≥ 这个次数就算「同一个问题被返工」。 */
export declare const REWORK_REPEAT_LIMIT: number;

/** 这个工具项算不算「干活」（思考 / 正文 / 用户消息不算）。 */
export declare function isWorkItem(item: unknown): boolean;
/** 返工签名（空串 = 不参与返工判定，只计入次数）。 */
export declare function workSignature(item: unknown): string;

/** 累计器：喂工具项，命中任一条规则时返回原因（一次性）。 */
export declare function createAutoSpeakTracker(options?: { toolLimit?: number; repeatLimit?: number }): {
  reset(): void;
  push(item: unknown): string | null;
  readonly state: { count: number; fired: boolean; reason: string };
};
