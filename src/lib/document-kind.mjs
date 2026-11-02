/**
 * 文档类产物识别（11-02）：工具结果里除媒体外，还常产出文档 / 表格 / 演示 / 压缩包 / 数据文件。
 * 与 media-kind.mjs 并列：只做扩展名归类与字符串扫描（不读盘），调用方用 fileExists 再确认。
 *
 * ⛔ 不收代码源文件（.ts/.py 等）：那些通常已在回合文件汇总卡里，重复出卡会让工具卡变得很长。
 */

export const DOCUMENT_EXTENSIONS = {
  doc: ["pdf", "doc", "docx", "rtf", "odt", "txt", "md", "markdown"],
  sheet: ["xls", "xlsx", "csv", "tsv", "ods"],
  slide: ["ppt", "pptx", "odp"],
  archive: ["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz"],
  data: ["json", "xml", "yaml", "yml", "html", "htm"],
};

const KIND_OF_EXT = new Map();
for (const [kind, exts] of Object.entries(DOCUMENT_EXTENSIONS)) {
  for (const ext of exts) KIND_OF_EXT.set(ext, kind);
}

export const DOCUMENT_KIND_LABELS = { doc: "文档", sheet: "表格", slide: "演示", archive: "压缩包", data: "数据" };

/** 文档类产物类型：doc/sheet/slide/archive/data；其它返回空串。 */
export function documentKindOf(value) {
  const s = String(value ?? "").trim();
  if (!s || /^data:/i.test(s)) return "";
  let pathname = s;
  if (/^https?:\/\//i.test(s)) {
    try { pathname = new URL(s).pathname; } catch { pathname = s; }
  }
  const name = pathname.split(/[?#]/)[0].split(/[\\/]/).pop() || "";
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? KIND_OF_EXT.get(match[1].toLowerCase()) ?? "" : "";
}

/* 与 media-kind 的路径规则同构：`/` 后跟空格不是 Unix 路径（「15 帧 / 10 KB」曾被吞成路径）。 */
const DOCUMENT_FILE_RE = /(?:[A-Za-z]:[\\/]|\/(?!\s)|https?:\/\/)[^"'`\r\n<>|]*?\.(?:pdf|docx?|rtf|odt|txt|md|markdown|xlsx?|csv|tsv|ods|pptx?|odp|zip|7z|rar|tar|gz|tgz|bz2|xz|json|xml|ya?ml|html?)(?:\?[^\s"'`<>]*)?(?:#[^\s"'`<>]*)?(?=$|[\s"'`,;:)\]}>*，。；：、！？（）【】《》“”‘’])/gi;

/** 从工具结果/对象里扫描文档产物路径（不读盘；自动去重）。 */
export function collectDocumentPaths(value, limit = 8) {
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const path = String(raw ?? "").trim().replace(/[)\]}>.,;:]+$/, "");
    if (!path) return;
    const kind = documentKindOf(path);
    if (!kind || seen.has(path)) return;
    seen.add(path);
    out.push({ path, kind });
  };
  const visit = (v) => {
    if (out.length >= limit) return;
    if (typeof v === "string") {
      let match;
      DOCUMENT_FILE_RE.lastIndex = 0;
      while ((match = DOCUMENT_FILE_RE.exec(v)) && out.length < limit) push(match[0]);
      return;
    }
    if (Array.isArray(v)) { for (const item of v) visit(item); return; }
    if (v && typeof v === "object") { for (const item of Object.values(v)) visit(item); }
  };
  visit(value);
  return out;
}
