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
export function pickTurnOf(
  turns: unknown,
  at?: number,
  bodyText?: string,
  opts?: { maxGapMs?: number; allowNewestFallback?: boolean },
): TeamTurn | null;
export function buildReplyQuotes(rows: unknown): Map<string, ReplyQuote>;
/** 话题消息：每条非 bot 消息 = 一个话题根，其后 bot 回复归到它（11-08 用户令）。 */
export type TopicRow = {
  key: string;
  authorId: string;
  authorKind: string;
  text: string;
  at?: number;
  via?: { memberId: string; name: string } | null;
  [key: string]: unknown;
};
export type TopicThread = { root: TopicRow; replies: TopicRow[] };
export function buildTopicThreads(rows: unknown): Map<string, TopicThread>;
export function topicThreadOf(threads: Map<string, TopicThread>, displayRow: Partial<TopicRow> | null | undefined): TopicThread | undefined;
