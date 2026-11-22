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
  const matches = String(text ?? "").match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  const out = [];
  for (const raw of matches) {
    const url = raw.replace(/[)\].,;!?，。；、）】]+$/g, "");
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
