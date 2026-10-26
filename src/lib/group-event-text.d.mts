/** 群广播文本解析的类型声明（实现：group-event-text.mjs）。 */

export type GroupEventBlock =
  | { type: "deliverable"; who: string; title: string; body: string; file: string }
  | { type: "batch"; count: number; items: { title: string; who: string; summary: string; file: string }[] }
  | { type: "review"; count: number; titles: string[]; output: string }
  | { type: "verdict"; who: string; title: string; passed: boolean; reviewer: string; reasons: string }
  | { type: "notice"; text: string };

export function parseGroupEvents(text: string): GroupEventBlock[] | null;
export function groupEventPlainText(blocks: GroupEventBlock[] | null | undefined): string;
/** 这段文本是不是群广播（宿主投进中枢会话的机器文本）—— 渲染层据此决定**摆在哪**。 */
export function isGroupEventText(text: string): boolean;
