export declare const DOCUMENT_EXTENSIONS: Record<"doc" | "sheet" | "slide" | "archive" | "data", string[]>;
export declare const DOCUMENT_KIND_LABELS: Record<string, string>;
export declare function documentKindOf(value: unknown): "" | "doc" | "sheet" | "slide" | "archive" | "data";
export declare function collectDocumentPaths(value: unknown, limit?: number): Array<{ path: string; kind: string }>;
