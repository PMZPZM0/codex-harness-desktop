/** URL 合法字符集（RFC 3986 常用子集）：遇到中文、空格、全角标点就截断。
 *  ⛔ 不能再用「非空白字符」——用户消息里 URL 后紧跟中文时会被整段吞成链接。 */
export const HTTP_URL_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+/gi;

/** 从任意文本里截出第一个合法 HTTP(S) URL（去掉尾部英文标点）。
 *  ⛔ 还要截断**百分号编码的非 ASCII 字符**（`%E6%B5%8B…` = 中文）：
 *     Markdown 自动链接会把 URL 后面紧跟的中文整体转义，若只按 ASCII 字符集判断，
 *     会把整段中文吞进 href（用户截图：链接后面跟着一串 %E6…）。 */
export function sanitizeHttpUrl(value) {
  const match = String(value ?? "").match(HTTP_URL_RE);
  if (!match) return "";
  let url = match[0];
  const encodedNonAscii = url.search(/%(?:E[0-9A-F]|F[0-9A-F])/i);
  if (encodedNonAscii >= 0) url = url.slice(0, encodedNonAscii);
  return url.replace(/[).,;!?]+$/g, "");
}

/** 百分号编码的中文/全角标点还原成可读文字（只用于链接外的尾部文本）。 */
export function decodePercentText(value) {
  const text = String(value ?? "");
  if (!/%[0-9A-F]{2}/i.test(text)) return text;
  try { return decodeURIComponent(text); } catch { return text; }
}

/**
 * 输入框里的链接自动识别（纯函数）。
 *
 * 用户 11-21：「输入框里面也加成这种自动识别效果，还有链接展示效果」——
 * 正文与输入框共用同一套识别：HTTP(S) 链接提取、GitHub 链接判定与显示名。
 *
 * @param {unknown} text
 * @returns {string[]}
 */
export function extractHttpUrls(text) {
  const matches = String(text ?? "").match(HTTP_URL_RE) ?? [];
  const out = [];
  for (const raw of matches) {
    const url = sanitizeHttpUrl(raw);
    if (!url || out.includes(url)) continue;
    out.push(url);
    if (out.length >= 5) break;
  }
  return out;
}

/** 是否 GitHub 仓库/主页链接。 */
export function isGithubUrl(url) {
  return /^https?:\/\/(?:www\.)?github\.com\//i.test(String(url ?? ""));
}

/** GitHub 链接的紧凑显示名（去掉 https://github.com/ 前缀；保留原 Path/query）。 */
export function githubLinkLabel(url) {
  return String(url ?? "").replace(/^https?:\/\/(?:www\.)?github\.com\//i, "");
}
