/** `craft-openers.mjs` 的类型面（纯函数；供 TS 侧 import）。 */
export declare const CRAFT_OPENERS: Array<{ id: string; name: string; extensions: string[] }>;
export declare function craftFileExtension(filePath: string): string;
export declare function craftOpenersFor(
  filePath: string,
  installedIds: Iterable<string>,
  options?: { limit?: number },
): Array<{ id: string; name: string }>;
