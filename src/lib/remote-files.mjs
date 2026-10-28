/**
 * 手机远控的文件访问口径（纯函数，预检【139d】真跑真值表）。
 *
 * ⛔ 手机端传来的路径是**外部输入**：只认「某个根目录之内」的路径，
 *    `..`、绝对路径、盘符切换、根目录本身以外的任何目标一律拒绝（返回空串）。
 */
import path from "node:path";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const TEXT_EXT = new Set([
  ".md", ".markdown", ".txt", ".log", ".csv", ".json", ".jsonl", ".yml", ".yaml", ".toml", ".ini", ".env",
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".scss", ".html", ".htm", ".xml", ".svg",
  ".py", ".java", ".kt", ".go", ".rs", ".c", ".cc", ".cpp", ".h", ".hpp", ".cs", ".rb", ".php", ".lua",
  ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd", ".sql", ".gradle", ".gitignore", ".dockerfile",
]);

/** 把相对路径接到根目录上；越界或非法一律返回空串。 */
export function safeJoin(root, rel) {
  if (!root || typeof root !== "string") return "";
  if (typeof rel !== "string") return "";
  const cleaned = rel.trim();
  if (!cleaned) return "";
  // 绝对路径 / 盘符 / UNC 一律不认：手机只能给相对路径
  if (path.isAbsolute(cleaned) || /^[a-zA-Z]:/.test(cleaned) || cleaned.startsWith("\\\\") || cleaned.startsWith("/")) return "";
  const base = path.resolve(root);
  const target = path.resolve(base, cleaned);
  if (target === base) return "";
  if (!target.startsWith(base + path.sep)) return "";
  return target;
}

/** 预览类型：image / text / other（other 不给看内容）。 */
export function previewKind(name) {
  const ext = path.extname(String(name ?? "")).toLowerCase();
  if (IMAGE_EXT.has(ext)) return "image";
  if (TEXT_EXT.has(ext)) return "text";
  return "other";
}
