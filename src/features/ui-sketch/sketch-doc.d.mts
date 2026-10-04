/** 界面草图纯函数层的类型面（真相源在 sketch-doc.mjs，本文件只是它的声明 —— 与 src/lib/*.d.mts 同款）。 */

/** 组件库条目：id 是 `ui_component_get` 认的那个 id。 */
export type SketchEntry = { id: string; cat: string; name: string; author: string; html?: string };

/** 上游 item 的必需四件套 + 我们唯一使用的扩展字段 note。 */
export type SketchItem = { id: string; kind: string; label: string; icon: string | null; variant: string; note?: string; supporting?: string };
export type SketchGroup = { id: string; x: number; y: number; axis: "x" | "y"; items: SketchItem[] };

/** 上游文档形状（m3e-canvas 的 Doc）：只声明我们读写的部分，其余原样带过。 */
export type SketchDoc = {
  title?: string;
  brief?: string;
  frame?: string;
  platform?: string;
  paletteKey?: string;
  frames: unknown[];
  groups: SketchGroup[];
  [key: string]: unknown;
};

export const SKETCH_ORIGIN: string;
export const SKETCH_ENTRY_URL: string;
export const SKETCH_BRIDGE_SOURCE: string;
export const SKETCH_DOC_KEY: string;
export const PROMPT_HTML_BUDGET: number;
export const SKETCH_KIND_BY_CAT: Record<string, string>;

export function isSketchDoc(value: unknown): boolean;
export function summarizeDoc(doc: unknown): { valid: boolean; title: string; frames: number; groups: number; items: number };
export function encodeShareHash(doc: unknown): string;
export function componentNote(entry: SketchEntry): string;
export function pickSpot(doc: unknown): { x: number; y: number };
export function appendComponents(doc: unknown, entries: SketchEntry[]): { doc: SketchDoc | null; added: SketchEntry[]; skipped: SketchEntry[] };
export function buildComponentPrompt(doc: unknown, entries: SketchEntry[]): { text: string; inlined: number; referenced: number };
export type SketchDiag = { locks?: boolean; root?: boolean; boot?: boolean; keys?: number; errors?: string[]; unavailable?: string };
export function describeDiag(diag: SketchDiag | undefined): string;
