/**
 * GitHub 国内加速前缀 —— 单一真相源（10-11 立）
 *
 * 背景：自更新检查/下载原来是 GitHub 裸连，国内用户检查更新超时/下载龟速是常态。
 * 插件市场（codex-official-market）与免费网关（free-gateway）已实测过「前缀镜像」这条路：
 * 在 `https://github.com/...` / `https://api.github.com/...` 前面拼一个反代前缀即可走国内线路。
 * 本模块把镜像表收敛成一份， updates / 市场模块全部从这里取。
 *
 * ⛔ 顺序即契约：gh-proxy → ghfast → 直连（空串）。
 *   - 10-11 实测（本机）：gh-proxy 对 api.github.com 与 releases 资产都通（API 200 / 资产 200 全量流）；
 *     ghfast 资产通（206 支持 Range）但 **API 已 403 "Invalid input"**（此前 AGENTS 记录的「两个都能代理
 *     API」已过时）—— 它排在第二只当下载通道与 API 的备用，失败立刻落到直连，代价是一次快速 403。
 *   - 直连永远是最后一档兜底：镜像站是第三方免费服务，倒了不至于更新不可用。
 *
 * ⛔ 这是第三方反代，不是 GitHub 官方：理论上能篡改流经的包体。安装包的防线是
 *   asset.digest（GitHub 对资产自带的 sha256）—— updates.ts 下载后会强制比对（有 digest 才校验）。
 *   ⛔⛔ 带令牌的请求**绝不允许**走镜像（令牌会泄露给第三方）：见 PPcode updates.ts 的 token 门。
 */

/** 镜像前缀表（空串 = 直连兜底；顺序即尝试序）。 */
export const GH_MIRROR_PREFIXES = ["https://gh-proxy.com/", "https://ghfast.top/", ""] as const;

/** 只对 GitHub 自家域名做前缀镜像；其它 host（自建分发 / 自定义清单）原样返回，不做任何改写。 */
const GH_MIRRORABLE_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "codeload.github.com",
]);

/** 一个 URL 的全部候选（镜像优先 + 直连兜底）；非 GitHub host 恒返回单元素。 */
export function mirrorCandidates(url: string): string[] {
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    return [url];
  }
  if (!GH_MIRRORABLE_HOSTS.has(hostname)) return [url];
  return GH_MIRROR_PREFIXES.map((prefix) => prefix + url);
}
