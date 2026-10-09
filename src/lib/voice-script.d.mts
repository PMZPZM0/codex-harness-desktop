/** 类型声明（与 voice-script.mjs 一一对应；.mjs 侧是真身，类型只在这里声明）。 */

/** 围栏语言标签（跨文件契约：指令 / 解析 / 守卫三处同一个词）。 */
export declare const VOICE_FENCE_LANG: "voice";
/** 建议播报稿上限（字符）。 */
export declare const VOICE_SCRIPT_MAX_CHARS: number;
/** 硬上限（字符）：模型写超长时的安全网。 */
export declare const VOICE_SCRIPT_HARD_CAP: number;

export declare function isVoiceFence(line: unknown): boolean;
export declare function isBareFence(line: unknown): boolean;
export declare function isPartialVoiceFence(line: unknown): boolean;

/** 抽取播报稿正文（整段文本；未闭合也取已写部分）。 */
export declare function extractVoiceScript(raw: unknown): { text: string; present: boolean };

/** 把播报稿整块剥掉（用于屏幕显示；未闭合时一直剥到结尾）。 */
export declare function stripVoiceScript(raw: unknown): string;

/** 流式剥离器（按 delta 喂；半截围栏会被按住，下一帧或 flush 再定）。 */
export declare function createVoiceScriptStripper(): {
  push(delta: string): string;
  flush(): string;
  reset(): void;
  readonly inVoiceBlock: boolean;
};

/** 播报稿清洗（朗读视图清洗 + 句边界截断）。 */
export declare function cleanVoiceScript(text: unknown, options?: { maxChars?: number }): string;

/** 播报去重键：只留字母/数字（含 CJK）、忽略大小写/空白/标点（三条播报入口查重用）。 */
export declare function spokenDedupeKey(text: unknown): string;

/** 回合结束「该念什么」的唯一裁决点：模型播报稿 → 本机压缩回退 → 空。 */
export declare function resolveAnnounceSummary(
  raw: unknown,
  options?: { maxChars?: number },
): { text: string; source: "script" | "fallback" | "empty"; sentences: number; kept: number; truncated: boolean };
