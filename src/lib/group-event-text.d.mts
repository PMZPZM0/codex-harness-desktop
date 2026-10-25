/** 群广播文本解析的类型声明（实现：group-event-text.mjs）。 */

export type GroupEventBlock =
  | { type: "deliverable"; who: string; title: string; body: string }
  | { type: "batch"; count: number; items: { title: string; who: string }[] }
  | { type: "review"; count: number; titles: string[] }
  | { type: "notice"; text: string };

export function parseGroupEvents(text: string): GroupEventBlock[] | null;
export function groupEventPlainText(blocks: GroupEventBlock[] | null | undefined): string;
