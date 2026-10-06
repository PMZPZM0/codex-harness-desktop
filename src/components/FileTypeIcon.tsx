/**
 * 文件类型图标（10-06 用户对照 WorkBuddy 截图：「还有对应文件图标也加上」）。
 * 扩展名 → 图标 + 配色，一处真相源；运行中「正在编辑文件」板块、编辑卡行、回合汇报卡
 * 三处消费同一张表（⛔ 别各写一份映射 —— 新增类型只改这里）。
 */
import { FileArchive, FileAudio, FileCode, FileCog, FileImage, FileJson, FileSpreadsheet, FileText, FileVideo } from "lucide-react";

type TypeRow = { exts: string[]; color: string; Icon: typeof FileCode };

/** ⛔ 顺序即匹配顺序（同名扩展名不许出现在两行）。守卫【11q】逐行对账这张表。 */
export const FILE_TYPE_TABLE: TypeRow[] = [
  { exts: ["ts", "tsx"], color: "#2f74c0", Icon: FileCode },
  { exts: ["js", "jsx", "mjs", "cjs"], color: "#b8860b", Icon: FileCode },
  { exts: ["py", "rb", "php", "lua"], color: "#2e8b6e", Icon: FileCode },
  { exts: ["rs", "go", "java", "kt", "swift", "c", "cc", "cpp", "h", "hpp", "cs"], color: "#b4633a", Icon: FileCode },
  { exts: ["css", "scss", "less"], color: "#2965c8", Icon: FileCode },
  { exts: ["html", "htm", "xml", "vue", "svelte"], color: "#c86a28", Icon: FileCode },
  { exts: ["sh", "bash", "zsh", "ps1", "bat", "cmd"], color: "#4e9a54", Icon: FileCode },
  { exts: ["json", "jsonc"], color: "#8a8a84", Icon: FileJson },
  { exts: ["md", "mdx"], color: "#5a79b8", Icon: FileText },
  { exts: ["txt", "log", "text"], color: "#8a8a84", Icon: FileText },
  { exts: ["toml", "yml", "yaml", "ini", "conf", "env"], color: "#8a8a84", Icon: FileCog },
  { exts: ["csv", "tsv", "xlsx", "xls"], color: "#207245", Icon: FileSpreadsheet },
  { exts: ["svg", "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"], color: "#bd34fe", Icon: FileImage },
  { exts: ["mp4", "mov", "webm", "avi", "mkv"], color: "#c86a28", Icon: FileVideo },
  { exts: ["mp3", "wav", "ogg", "flac", "m4a"], color: "#4e9a54", Icon: FileAudio },
  { exts: ["zip", "tar", "gz", "7z", "rar"], color: "#8a8a84", Icon: FileArchive },
];

export function fileExtOf(path: string): string {
  const name = String(path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  const cut = name.lastIndexOf(".");
  return cut > 0 ? name.slice(cut + 1).toLowerCase() : "";
}

export function fileTypeVisual(path: string): { Icon: typeof FileCode; color: string; ext: string } {
  const ext = fileExtOf(path);
  for (const row of FILE_TYPE_TABLE) if (row.exts.includes(ext)) return { Icon: row.Icon, color: row.color, ext };
  return { Icon: FileText, color: "#8a8a84", ext };
}

export function FileTypeIcon({ path, size = 14, className }: { path: string; size?: number; className?: string }) {
  const { Icon, color, ext } = fileTypeVisual(path);
  return (
    <span className={`file-type-icon${className ? ` ${className}` : ""}`} style={{ color }} title={ext ? `.${ext}` : "文件"} aria-hidden>
      <Icon size={size} />
    </span>
  );
}
