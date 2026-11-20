/**
 * GitHub 加速前缀 —— 单一真相源（10-11 立；11-15 按实测重排）
 *
 * 背景：自更新检查/下载原来走 GitHub 裸连，国内用户超时/龟速是常态；
 * 于是把所有 GitHub 请求前面拼一个反代前缀。本模块把镜像表收敛成一份，updates / 市场 / 开发工具全从这里取。
 *
 * ⛔⛔ 11-15 **实测推翻了「国内镜像优先」这条老结论**（用户报「音色模型下载 12s 超时」「开发工具 100MB 下几个小时」）。
 *   测法：同一个 54MB GitHub release 资产，8 秒采样，读实际字节数（`node .workbuddy/tmp/mirror-speed.mjs`）：
 *
 *   | 通道                | 状态 | TTFB   | 吞吐          |
 *   |---------------------|------|--------|---------------|
 *   | 直连 GitHub         | 206  | 1.4s   | **12.6 MB/s** |
 *   | hk.gh-proxy.com     | 206  | 1.7s   | **12.4 MB/s** |
 *   | gh-proxy.com（旧首选）| 206 | 1.0s   | **269 KB/s**（慢 47 倍）|
 *   | gh-proxy.net        | 200  | 4.1s   | 6 KB/s        |
 *   | ghfast.top（旧次选）| 403  | 1.0s   | 0（Range 直接 403）|
 *   | ghproxy.net / github.moeyy.xyz / ghp.ci | — | — | 连不上 |
 *
 *   ⇒ 旧序（gh-proxy → ghfast → 直连）**恰好把最慢的放最前、最快的放最后**：
 *     54MB 模型从 4 秒变 200 秒，100MB 工具包能拖成几十分钟到几小时。
 *   ⇒ 新序 **直连 → hk.gh-proxy.com → gh-proxy.com**；ghfast 删除（Range 已 403，留着只是多一次失败）。
 *
 *   ⛔ 例外：`api.github.com` 的**元数据接口**直连在国内经常 403/超时（10-11 实测 API 必须走镜像）
 *     ⇒ API 单独一套「镜像优先」的序，不与资产共用。
 *   ⛔ 「直连优先」的前提是客户端能连上 GitHub：连不上时第一次请求会在 `downloadOnce` 的
 *     headersTimeout 内失败并落到镜像，代价是一次快速失败，不会卡死。
 *
 * ⛔ 这是第三方反代，不是 GitHub 官方：理论上能篡改流经的包体。安装包的防线是
 *   asset.digest（GitHub 对资产自带的 sha256）—— updates.ts 下载后会强制比对（有 digest 才校验）。
 *   ⛔⛔ 带令牌的请求**绝不允许**走镜像（令牌会泄露给第三方）：见 updates.ts 的 token 门。
 */

/** 大文件资产/源码包的前缀序：**直连优先**，镜像只作兜底（空串 = 直连，必须排第一）。
 *  ⛔ 每次发版前必须重测（镜像会变，已经反转两次）：
 *   11-15 ghfast 对 Range 请求 403 → 删；11-19 复测 ghfast 0.82MB/s 最快 → 加回第二档；
 *   11-20 复测**又反转**：gh-proxy.com 0.68 MB/s（单次峰值到过 10.2MB/s，波动大）
 *   > ghfast.top 0.095 MB/s（掉到几十 KB/s，用户实测「一直 0%」），hk 仍 302 不可用
 *   ⇒ gh-proxy 提到第二档。⛔ 别按旧结论钉死顺序。 */
export const GH_MIRROR_PREFIXES = ["", "https://gh-proxy.com/", "https://hk.gh-proxy.com/", "https://ghfast.top/"] as const;

/** 元数据 API 的前缀序：镜像优先（api.github.com 直连在国内常 403/超时）。 */
export const GH_API_MIRROR_PREFIXES = ["https://gh-proxy.com/", "https://hk.gh-proxy.com/", ""] as const;

/** 只对 GitHub 自家域名做前缀镜像；其它 host（自建分发 / 自定义清单）原样返回，不做任何改写。 */
const GH_MIRRORABLE_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "codeload.github.com",
]);

/** 一个 URL 的全部候选；非 GitHub host 恒返回单元素。
 *  ⛔ API 与资产**不同序**（见文件头实测表）：资产直连快 47 倍，API 直连根本不通。 */
export function mirrorCandidates(url: string): string[] {
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    return [url];
  }
  if (!GH_MIRRORABLE_HOSTS.has(hostname)) return [url];
  const table = hostname === "api.github.com" ? GH_API_MIRROR_PREFIXES : GH_MIRROR_PREFIXES;
  return table.map((prefix) => prefix + url);
}
