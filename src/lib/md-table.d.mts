/** GFM 表格块的解析与回写（纯函数；只动表格块、其余原文逐字保留）。 */
export type MdTableBlock = { start: number; end: number; rows: string[][] };
export type MdTableParseResult = { blocks: MdTableBlock[]; lines: string[] };
export function parseMarkdownTables(text: unknown): MdTableParseResult;
export function renderMarkdownTables(original: string, edits: string[][][]): string;
