/** imageUrl（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { localImageUrl } from "./image-src.mjs";

export function imageUrl(path: string) {
  // 双编码细节与理由见 src/lib/image-src.mjs（纯函数，可离线断言），此处只做转发
  return localImageUrl(path);
}
