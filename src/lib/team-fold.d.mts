/** 群聊运行过程折叠的口径（纯函数，见 team-fold.mjs） */

export type TeamTurn = {
  id?: string;
  status?: string;
  items?: Array<{ id?: string; type?: string; text?: string; [key: string]: unknown }>;
  startedAt?: number | null;
  completedAt?: number | null;
  [key: string]: unknown;
};

export type ReplyQuote = { authorId: string; text: string };

export const FOLD_QUOTE_CHARS: number;
export function epochMsOf(value: unknown): number;
export function turnBodyOf(turn: unknown): string;
export function pickTurnOf(turns: unknown, at?: number, bodyText?: string): TeamTurn | null;
export function buildReplyQuotes(rows: unknown): Map<string, ReplyQuote>;
