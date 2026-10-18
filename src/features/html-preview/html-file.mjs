/**
 * HTML 实时预览 · 纯判定（可被守卫直接真跑）。
 *
 * 输入 = turn-file-changes / turn-file-changes-live 的 files 数组
 * （`{ path, status, added, deleted }`）；输出 = 这次该预览哪个 HTML 文件。
 * ⛔ 只认 `.html / .htm / .xhtml`；已删除的文件不预览。
 * 选择顺序：**本次报告里还没见过的最新一个** → 上次那个（还在报告里）→ 报告里最后一个。
 * seenPaths 由调用方跨事件维护（否则 live 报告每次都带全部累计文件，会在两个 HTML 之间来回跳）。
 */
export const HTML_FILE_RE = /\.(html?|xhtml)$/i;

export function isHtmlPath(value) {
  return typeof value === "string" && HTML_FILE_RE.test(value.trim());
}

/** 从文件变更数组里挑一个 HTML 预览目标；没有合适的返回 ""。 */
export function pickHtmlPreviewPath(files, lastPath = "", seenPaths = []) {
  const list = (Array.isArray(files) ? files : [])
    .filter((file) => file && String(file.status ?? "") !== "deleted" && isHtmlPath(file.path))
    .map((file) => String(file.path).trim())
    .filter(Boolean);
  if (!list.length) return "";
  const seen = new Set(Array.isArray(seenPaths) ? seenPaths : []);
  const fresh = [...list].reverse().find((path) => !seen.has(path));
  if (fresh) return fresh;
  if (lastPath && list.includes(lastPath)) return lastPath;
  return list[list.length - 1];
}
