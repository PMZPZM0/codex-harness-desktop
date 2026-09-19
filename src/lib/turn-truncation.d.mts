// 类型声明：turn-truncation.mjs 是运行时实现，tsconfig 关着 allowJs，故类型单独声明。
// 改实现时同步这里（预检守卫会跑真实实现，漏改会立刻红）。

/** 多长的思考算「深思很久」：≈3000+ tokens 的思考体量。 */
export declare const TRUNCATE_REASONING_MIN_CHARS: number;
/** 正文少于多少字符视为「没有产出」。 */
export declare const TRUNCATE_OUTPUT_MAX_CHARS: number;

/** 回合的思考 / 正文 / 工具项统计。 */
export declare function turnOutputStats(turn: unknown): { reasoningChars: number; outputChars: number; toolItems: number };

/**
 * 判定回合是否「被截断的空转」：思考很长 且 正文为空/极短 且 全程没有工具动作。
 * 三者同时成立才判（防误报）；应用对思考/输出长度**不做任何限制**，这只是检测。
 */
export declare function isTruncatedEmptyTurn(turn: unknown): boolean;

/** 给用户看的说明（中文，说明是供应商单次输出上限所致，应用未做限制）。 */
export declare function truncationNotice(): string;

/** 同一会话在多少毫秒内最多自动续接几次（防「思考→截断→又思考」死循环烧钱）。 */
export declare const AUTO_CONTINUE_WINDOW_MS: number;
export declare const AUTO_CONTINUE_MAX_ATTEMPTS: number;

/** 自动续接时发给引擎的指令：从上次中断处承接续写（不重想、不重复）。 */
export declare function autoContinuePrompt(): string;
