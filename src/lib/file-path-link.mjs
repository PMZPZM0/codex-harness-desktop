/**
 * 行内文件链接的判据（Markdown 行内代码 → 可点文件项）。
 *
 * 用户 11-21 对照 Qoder：「qodeR 就是在汇总消息里面展示的」——文件应直接出现在正文句子里，
 * 不再在文字下面另排一排芯片。这里只做「像不像文件路径」的纯判定，点击仍走 right-file 事件箱。
 *
 * @param {unknown} candidate
 * @returns {boolean}
 */
export function looksLikeFilePath(candidate) {
  const trimmed = String(candidate ?? "").replace(/^[`"'\s]+|[`"'\s]+$/g, "");
  if (!trimmed || trimmed.length > 4096) return false;
  const hasDrive = /^[A-Za-z]:[\\/]/.test(trimmed);
  if (!hasDrive && /[<>:"|?*\u0000-\u001f]/.test(trimmed)) return false;
  // 版本号 / 纯数字 token 不是文件
  if (/^[vV]?\d[\d.,]*\d$/.test(trimmed)) return false;
  if (/\.\d{1,5}$/.test(trimmed)) return false;
  if (hasDrive) return /\.[A-Za-z0-9]{1,5}$/.test(trimmed);
  if (trimmed.startsWith("~/") || trimmed.startsWith("./") || trimmed.startsWith("../")) return true;
  if (/[\\/]/.test(trimmed) && /\.[A-Za-z0-9]{1,5}$/.test(trimmed)) return true;
  if (/\s/.test(trimmed)) return false;
  return /^[A-Za-z0-9_.\u4e00-\u9fa5-]+\.[A-Za-z0-9]{1,5}$/.test(trimmed);
}

/** 行内链接显示名（只留文件名；完整路径放 title）。 */
export function fileNameOf(path) {
  const norm = String(path ?? "").replaceAll("\\", "/");
  const cut = norm.lastIndexOf("/");
  return cut >= 0 ? norm.slice(cut + 1) : norm;
}
