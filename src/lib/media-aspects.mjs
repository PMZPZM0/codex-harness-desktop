/**
 * media-aspects —— 画幅常量（**纯常量，无 node 依赖**）。
 *
 * ⛔ 为什么单独一个文件：`video-providers.mjs` 用了 `node:crypto`（可灵 JWT 签名），
 *    **渲染层不许 import 它**（守卫【192】）；而画幅常量两边都要用（渲染层下拉 + 适配层映射）。
 *    把常量抽到这个无依赖文件，两边各自取 —— 既不违规，又只有一份真相源。
 */
export const VIDEO_ASPECTS = ["16:9", "9:16", "1:1"];
