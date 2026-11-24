/** imageUrl（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { imageDisplaySrc } from "./image-src.mjs";

/** 任意图片来源 → 可渲染 URL（统一转发 image-src.mjs；file: / data / http / 本地路径都归一）。 */
export function imageUrl(path: string) {
  return imageDisplaySrc(path);
}

/**
 * `<img onError>` 的兜底：本地图**偶发**加载失败不该变成永久空白。
 *
 * ⛔⛔ 11-25 用户实测「重启后直接全是破图 / 缩略图消失」：图片列表在一次会话重排里
 * 被 React 卸载又挂上，浏览器把未完成的请求 abort 掉 → 触发 onError → 老代码
 * `display:none` 一按到底，之后图**永远**不显示（哪怕再点一次就能加载）。
 * 这里带破缓存参数重试一次；仍然失败才隐藏（角标仍在，用户知道这儿有张图）。
 *
 * ⛔ 只对本地协议安全的 URL 用（`imageUrl()` 的产物）；远程图重试会重复消耗流量。
 */
export function retryLocalImage(event: { currentTarget: HTMLImageElement }, src: string): void {
  const img = event.currentTarget;
  if (img.dataset.retried === "1") {
    /* 第二次仍失败：**不隐藏**。留着破图占位 + alt，用户至少知道"这儿有张图、它坏了"，
       比一块永久空白（还以为被吞了）更容易判断。 */
    img.dataset.failed = "1";
    return;
  }
  img.dataset.retried = "1";
  img.src = `${src}${src.includes("?") ? "&" : "?"}retry=1`;
}
