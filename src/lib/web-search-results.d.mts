export type WebSearchResult = { url: string; title: string; snippet: string; host: string };
export declare function webSearchResultsOf(item: unknown, limit?: number): WebSearchResult[];
export declare function webSearchHostOf(url: unknown): string;
