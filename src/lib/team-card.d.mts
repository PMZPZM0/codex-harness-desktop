/** 卡片解析（纯函数，见 team-card.mjs） */

export type InlineSpan =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

export type CardBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "code"; lang: string; text: string }
  | { type: "quote"; text: string }
  | { type: "hr" };

export const MAX_CARD_BLOCKS: number;
export function parseInline(text: string): InlineSpan[];
export function parseCard(text: string): CardBlock[];
export function cardToPlain(text: string, max?: number): string;
