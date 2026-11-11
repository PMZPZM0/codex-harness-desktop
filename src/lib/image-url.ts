/** imageUrl（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { imageDisplaySrc } from "./image-src.mjs";

/** 任意图片来源 → 可渲染 URL（统一转发 image-src.mjs；file: / data / http / 本地路径都归一）。 */
export function imageUrl(path: string) {
  return imageDisplaySrc(path);
}
