/**
 * GitHub 加速前缀 —— **全应用唯一真相源**（11-21 从 `electron/gh-mirror.ts` 提上来）。
 *
 * 为什么提到 `src/lib/`：主进程与渲染层都要用（渲染层「GitHub 热门」与「前端设计」的
 * 上游提交查询是直接 fetch 的），而 ⛔ `electron/` 与 `src/` 互不 import（【159】）。
 * 提取前两边各写一份前缀表，实测出更快的源时只能改一处、另一处继续慢 —— 用户的原话是
 * 「应用必须全部走镜像快速通道」。
 *
 * ⛔⛔ 顺序必须按实测，且**每次发版前重测**（已经反转过三次）：
 *   11-15：直连 12.6MB/s ≈ hk 12.4MB/s ≫ gh-proxy.com 269KB/s，ghfast 对 Range 403 ⇒ 删 ghfast。
 *   11-19：复测 ghfast 0.82MB/s 最快 ⇒ 加回。11-20：又反转（gh-proxy.com 0.68 > ghfast 0.095）。
 *   11-21（v0.0.76 资产 8MB Range）：**gh-proxy.org 0.84~1.56MB/s 且支持 206** ＞ gh-proxy.com
 *     0.37MB/s（且**忽略 Range**，回 200 全量）＞ 直连/ghfast 超时、hk 500、ghproxy.net 17KB/s。
 *     ⇒ 新增 gh-proxy.org 到第二档（也是分片并发唯一可用的源）。
 *
 * ⛔ `api.github.com` 元数据接口**直连在国内常 403/超时** ⇒ 单独一套「镜像优先」的序，不与资产共用。
 * ⛔ 带令牌的请求**绝不允许**走镜像（令牌会泄露给第三方）。
 */

/** 大文件资产 / 源码包：直连优先（能通时最快），镜像兜底；空串 = 直连，必须排第一。 */
export const GH_MIRROR_PREFIXES = ["", "https://gh-proxy.org/", "https://gh-proxy.com/", "https://hk.gh-proxy.com/", "https://ghfast.top/"];

/** 元数据 API：镜像优先（api.github.com 直连在国内不通）。 */
export const GH_API_MIRROR_PREFIXES = ["https://gh-proxy.org/", "https://gh-proxy.com/", "https://hk.gh-proxy.com/", ""];

/** 只对 GitHub 自家域名做前缀镜像；其它 host（自建分发 / 自定义清单）原样返回，不做任何改写。 */
export const GH_MIRRORABLE_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "codeload.github.com",
]);

/** 一个 URL 的全部候选；非 GitHub host 恒返回单元素。⛔ API 与资产**不同序**。 */
export function mirrorCandidates(url) {
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
