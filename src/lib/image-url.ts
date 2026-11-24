/** imageUrl（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { imageDisplaySrc } from "./image-src.mjs";

/** 任意图片来源 → 可渲染 URL（统一转发 image-src.mjs；file: / data / http / 本地路径都归一）。 */
export function imageUrl(path: string) {
  return imageDisplaySrc(path);
}

/** 本地图片的 MIME：`readImage` 回来的是裸字节，建 Blob 时必须给对类型，否则 <img> 不认。 */
function imageMimeOf(path: string): string {
  const ext = String(path ?? "").toLowerCase().split(".").pop() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "bmp") return "image/bmp";
  if (ext === "avif") return "image/avif";
  if (ext === "svg") return "image/svg+xml";
  return "image/png";
}

/**
 * `<img onError>` 的两级兜底 —— 本地图**一定**要能显示出来。
 *
 * ⛔⛔ 11-25 用户第三次反馈（「图片又加载不出来了 / 这机制不行」）之后的定论：
 *   `harness-image` 自定义协议在真实主窗口里**偶发不可用**（查了三轮：文件在、CSP 放行、
 *   同一个 URL 在探针里能出图，但真实窗口就是失败）。与其继续猜协议，不如给它一条
 *   **不依赖协议**的退路。
 *
 *   ① 第一次失败：多半是请求被 abort（消息重排 / 切会话）⇒ 带破缓存参数再要一次；
 *   ② 仍失败：**绕开协议**，走 IPC（`image-lab:read`）取字节建 Blob URL ——
 *      图像工坊浮窗一直走这条路，从来没出过问题。
 *
 * ⛔ 只在失败时才走 IPC（正常路径零额外开销）；仍失败才留破图占位（不 display:none，
 *    一块空白比破图更难判断）。
 */
export function retryLocalImage(event: { currentTarget: HTMLImageElement }, src: string, path?: string): void {
  const img = event.currentTarget;
  const attempt = img.dataset.retried ?? "0";
  if (attempt === "0") {
    img.dataset.retried = "1";
    img.src = `${src}${src.includes("?") ? "&" : "?"}retry=1`;
    return;
  }
  if (attempt === "1" && path) {
    img.dataset.retried = "2";
    void window.codex.readImage(path)
      .then((result) => {
        const bytes = result?.data as unknown as BlobPart;
        if (!bytes) throw new Error("empty");
        img.src = URL.createObjectURL(new Blob([bytes], { type: imageMimeOf(path) }));
      })
      .catch(() => { img.dataset.failed = "1"; });
    return;
  }
  img.dataset.failed = "1";
}
