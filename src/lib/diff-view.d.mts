// diff 预览解析（.mjs）的类型声明
export type DiffViewRow = { kind: "meta" | "hunk" | "add" | "del" | "ctx"; text: string; oldNo: number | null; newNo: number | null };
export type DiffSplitRow =
  | { kind: "meta" | "hunk"; text: string }
  | { kind: "pair"; left: DiffViewRow | null; right: DiffViewRow | null };
export declare function parseDiffLines(text: string): DiffViewRow[];
export declare function filterWhitespaceOnlyRows(rows: DiffViewRow[]): DiffViewRow[];
export declare function buildSplitDiffRows(rows: DiffViewRow[]): DiffSplitRow[];
export declare function isSingleSidedDiff(rows: DiffViewRow[]): boolean;
