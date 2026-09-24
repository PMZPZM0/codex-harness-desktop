/** 消息正文 markdown 分块（实现见 ./markdown-blocks.mjs） */
export function isListItemLine(line: string): boolean;
export function trimInvisibleSpace(line: string): string;
export function softenListTailLazyContinuation(block: string): string;
export function splitMarkdown(text: string): string[];
