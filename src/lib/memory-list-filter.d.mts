/** memory-list-filter.mjs 的类型声明（TS7016：.mjs 需配 .d.mts） */
export type OptionRow = { value: string; label: string };

export declare const MEMORY_STATUS_OPTIONS: OptionRow[];
export declare const MEMORY_CONTENT_OPTIONS: OptionRow[];
export declare const ATOM_TYPE_OPTIONS: OptionRow[];
export declare const ATOM_SCOPE_OPTIONS: OptionRow[];
export declare const ATOM_STATUS_OPTIONS: OptionRow[];

export declare function matchesQuery(text: string, query: string): boolean;

/** 泛型保留调用方附带的字段（如 memoryDir / body），⛔ 不然批量操作拿不到数据。 */
export declare function filterRows<T>(
  rows: T[],
  opts?: { query?: string; textOf?: (row: T) => string; predicates?: Array<(row: T) => boolean> },
): T[];

export declare function toggleSelection(selected: string[], visibleIds: string[], checked: boolean): string[];
