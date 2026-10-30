/** 回落的提示回调：**语气随消息一起给**（这两条只会在"已找到并打开"时发出 ⇒ success/绿色）。 */
export type PathFallbackNotify = (message: string, tone?: "success" | "error" | "warning" | "info") => void;
/** 路径回落判据（卡片路径打不开时是否改用会话台账里的同名真实文件）。 */
export function pickKnownPathFallback(input: { requested: string; known: string; workspace?: string }): string;
/** 打开前的兜底：路径不存在 → 查会话台账 → 主进程按文件名扫盘找回（可注入 lookup / notify）。 */
export function resolveExistingFile(
  requested: string,
  options?: { workspace?: string; lookup?: (path: string) => string | null; notify?: PathFallbackNotify },
): Promise<string>;
/** 相对路径按会话工作目录补成绝对路径（唯一实现，别在别的文件里再写一份）。 */
export function joinWorkspacePath(raw: string, workspace: string): string;
/** 「打开这个文件」的统一入口：补绝对路径 + 不存在就回落（台账 → 扫盘）。 */
export function resolveForOpen(
  raw: string,
  options?: { workspace?: string; lookup?: (path: string) => string | null; notify?: PathFallbackNotify },
): Promise<string>;
