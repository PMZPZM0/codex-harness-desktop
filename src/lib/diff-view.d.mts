// diff 预览解析（.mjs）的类型声明
export type DiffViewRow = { kind: "meta" | "hunk" | "add" | "del" | "ctx"; text: string; oldNo: number | null; newNo: number | null };
export declare function parseDiffLines(text: string): DiffViewRow[];
