/** imageUrl（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { localImageUrl } from "./image-src.mjs";

/** 本地图片路径 → 可渲染 URL（实现转发 `image-src.mjs` 的纯函数，⛔ 别在这里再写一套编码）。 */
export function imageUrl(path: string) {
  // 双编码细节与理由见 src/lib/image-src.mjs（纯函数，可离线断言），此处只做转发
  return localImageUrl(path);
}
