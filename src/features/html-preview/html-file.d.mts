/** HTML 实时预览 · 纯判定的类型。 */
export declare const HTML_FILE_RE: RegExp;
export declare function isHtmlPath(value: unknown): boolean;
export declare function pickHtmlPreviewPath(
  files: Array<{ path?: string; status?: string }> | null | undefined,
  lastPath?: string,
  seenPaths?: string[],
): string;
