// 类型声明：turn-unfinished.mjs 是运行时实现，tsconfig 关着 allowJs，故类型单独声明。
// 改实现时同步这里（预检守卫会跑真实实现，漏改会立刻红）。

/** 末条 assistant 正文（已剥 `voice` 播报块）。 */
export declare function lastAssistantText(turn: unknown): string;
/** 本回合最后一次工具输出（commandExecution / functionCallOutput / mcp 类）。 */
export declare function lastToolOutput(turn: unknown): string;
/** 引擎「命令还在跑 / 剩余输出读不回来」的原文标记。 */
export declare const PARTIAL_OUTPUT_MARKERS: RegExp[];
/** 末句是不是「宣布下一步」式收尾（不含问句、不含明确收尾语）。 */
export declare function isPromiseEnding(text: unknown): boolean;
/** 本回合「没干完」的原因；空串 = 干完了（或按保守原则不判）。 */
export declare function unfinishedTurnReason(turn: unknown): "" | "promise" | "partial-command";
/** 给用户看的提示条文案。 */
export declare function unfinishedNotice(reason: string): string;
/** 自动补发的指令（承接执行语义：别再复述计划）。 */
export declare function unfinishedContinuePrompt(reason: string): string;
