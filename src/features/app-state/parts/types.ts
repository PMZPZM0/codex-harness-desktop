/** useHarnessApp 体内抽出的局部类型（供各 part 共用，实现未改） */

import "@xterm/xterm/css/xterm.css";
export type RateLimitCtx = { input: any[]; model: string; effort: string | null; personality: string | null };
export type BotEntry = { id: string; name: string; channel: string; enabled: boolean; [key: string]: unknown };
