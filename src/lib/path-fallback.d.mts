/** 路径回落判据（卡片路径打不开时是否改用会话台账里的同名真实文件）。 */
export function pickKnownPathFallback(input: { requested: string; known: string; workspace?: string }): string;
/** 打开前的兜底：路径不存在 → 查会话台账 → 用同名真实文件（可注入 lookup / notify）。 */
export function resolveExistingFile(
  requested: string,
  options?: { workspace?: string; lookup?: (path: string) => string | null; notify?: (message: string) => void },
): Promise<string>;
