/**
 * 视频接口的「可选覆盖字段」清单（渲染层副本）。
 *
 * ⛔ 为什么要复制一份、而不是从 `src/lib/video-providers.mjs` import：
 *   那个模块顶部 `import { createHmac } from "node:crypto"`（可灵 JWT 签名用）——
 *   **渲染层没有 node 内置模块**。vite dev 下解构导入会直接抛
 *   「Module "node:crypto" has been externalized for browser compatibility」，
 *   生产构建只是侥幸不炸（externalize 成空代理）。渲染层不碰主进程逻辑模块。
 *
 * ⛔ 两份必须一致：守卫【193】直接比对这里的字面量与适配层的 `VIDEO_OPTIONAL_FIELDS`，
 *   少一个 ⇒ 用户填了保存不住（主进程白名单只收清单里的字段）。
 */
export const OPTIONAL_FIELDS = ["baseUrl", "model"] as const;
