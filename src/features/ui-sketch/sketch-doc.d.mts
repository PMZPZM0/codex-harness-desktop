/** 界面草图纯函数层的类型面（真相源在 sketch-doc.mjs，本文件只是它的声明 —— 与 src/lib/*.d.mts 同款）。 */

/** 上游 item 的必需四件套 + 我们读到的扩展字段（note 会原样进它导出的提示词）。 */
export type SketchItem = { id: string; kind: string; label: string; icon: string | null; variant: string; note?: string; supporting?: string; action?: { to?: string; transition?: string } };
export type SketchGroup = { id: string; x: number; y: number; axis: "x" | "y"; items: SketchItem[] };
export type SketchFrame = { id: string; name: string; x: number; y: number; w?: number; h?: number; note?: string; [key: string]: unknown };

/** 上游文档形状（m3e-canvas 的 Doc）：只声明我们读的部分，其余原样带过。 */
export type SketchDoc = {
  title?: string;
  brief?: string;
  frame?: string;
  platform?: string;
  paletteKey?: string;
  frames: SketchFrame[];
  groups: SketchGroup[];
  [key: string]: unknown;
};

/** 桥随每条应答一起带回来的诊断（跨源看不见里面，只有这几个布尔值可用）。 */
export type SketchDiag = { locks?: boolean; root?: boolean; boot?: boolean; keys?: number; errors?: string[]; unavailable?: string };

export const SKETCH_ORIGIN: string;
export const SKETCH_ENTRY_URL: string;
export const SKETCH_BRIDGE_SOURCE: string;
export const SKETCH_DOC_KEY: string;

export const SKETCH_ITEM_KINDS: string[];
export const SKETCH_ITEM_VARIANTS: string[];

export function isSketchDoc(value: unknown): boolean;
export function validateSketchDoc(doc: unknown): { ok: true } | { ok: false; reason: string };
export function summarizeDoc(doc: unknown): { valid: boolean; title: string; frames: number; groups: number; items: number };
export function describeDiag(diag: SketchDiag | undefined): string;
export function buildSketchPrompt(doc: unknown): { text: string; frames: number; items: number };
