/**
 * `sketch://` —— 随包的「手机前端UI」静态站（10-05 立，展示名 10-05 夜从「界面草图」改来；m3e-canvas 的 next 静态导出）。
 *
 * 为什么必须另开一个协议（而不是 file:// 或复用 harness-image / pet）：
 * 1. 那份产物里**所有资源都是绝对路径**（`/_next/static/chunks/*.js`、`/material-symbols.json`），
 *    用 `file://…/dist/sketch/index.html` 加载时它们会解析到**文件系统根**，全站 404。
 *    协议把站点变成"站点即根"：`sketch://app/…` ⇒ 绝对路径天然对得上。
 * 2. harness-image / pet 两个协议的扩展名白名单**只放图片**（其余 415）。这里必须放
 *    html/js/css —— 放宽它们等于给渲染层一个「读站点目录以外的任意文件」的原语，是安全回归。
 * 3. 根**恒等于打包内的 `dist/sketch`**（Vite 从 `public/sketch` 拷来，⛔ 不是用户可写目录），
 *    所以这条通道能读的文件集合与"随包只读资源"完全重合 ⇒ 面没有扩大。
 *
 * `registerSchemesAsPrivileged` 的两个开关各管一件事（都在 electron/main.ts 声明）：
 * · `standard: true` —— 让 `sketch://app/<路径>` 成为**有 host 的标准 URL**：相对/绝对路径解析、
 *   origin 判定、宿主 CSP 的 `frame-src sketch:` 匹配全都依赖它。
 * · `secure: true` —— 给站点安全上下文。上游用 Web Locks API（`navigator.locks`）做"同一份草图
 *   只允许一个可写实例"的单写者锁，**非安全上下文里这个 API 直接不存在** ⇒ 草图会静默降级成
 *   没有并发保护，而不是报错。静默降级是最难发现的那类故障（同 pet:// 的 CSP 事故同型）。
 */
import { app } from "electron";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const SKETCH_SCHEME = "sketch";

/** 站点根 = 打包内的 dist/sketch。单一真相源：协议与就绪判定都从这里取。 */
export function sketchRoot(): string {
  return path.join(app.getAppPath(), "dist", "sketch");
}

/** 扩展名 → Content-Type。⛔ 白名单即协议的全部能力面：不在表里一律 415。
 *  JS 必须是 `text/javascript` —— 模块脚本的 MIME 不对会被 Chromium 直接拒执行。 */
export const SKETCH_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export type SketchResolution =
  | { ok: true; file: string; mime: string }
  | { ok: false; status: number; reason: string };

/** 把 sketch://app/<路径> 解析成站点内的一个文件（纯函数：root 由调用方给，便于真跑断言）。
 *  ⛔ 越界（`..`、另一个盘符、站点外）一律 403 —— 与 pet:// 同一套 relative 判据。 */
export function resolveSketchFile(rawUrl: string, root: string): SketchResolution {
  let pathname = "/";
  try {
    pathname = decodeURIComponent(new URL(rawUrl).pathname);
  } catch {
    return { ok: false, status: 400, reason: "Bad url" };
  }
  const normalized = path.posix.normalize(pathname);
  const rel = normalized.replace(/^\/+/, "");
  const resolved = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    return { ok: false, status: 403, reason: "Forbidden" };
  }
  /* trailingSlash:true 的站点里 /x/ 就是 /x/index.html（只允许站点内的一级回落） */
  const candidate = existsSync(resolved) && statSync(resolved).isDirectory()
    ? path.join(resolved, "index.html")
    : resolved;
  const ext = path.extname(candidate).toLowerCase();
  const mime = SKETCH_MIME[ext];
  if (!mime) return { ok: false, status: 415, reason: "Unsupported media type" };
  if (!existsSync(candidate)) return { ok: false, status: 404, reason: "Not found" };
  return { ok: true, file: candidate, mime };
}

export function sketchResponse(rawUrl: string, root = sketchRoot()): Response {
  const found = resolveSketchFile(rawUrl, root);
  if (!found.ok) return new Response(found.reason, { status: found.status });
  try {
    /* 随包只读资源：整份读进内存即可（最大的一个文件是 1.4MB 的图标字体），
       不必引 stream —— 少一层错误处理面。 */
    return new Response(readFileSync(found.file), {
      status: 200,
      headers: { "Content-Type": found.mime, "Cache-Control": "no-cache" },
    });
  } catch {
    return new Response("Read failed", { status: 500 });
  }
}

/** 站点在不在：产物被删/没构建时给渲染层一个可读结论，而不是白屏 iframe。 */
export function sketchBundleReady(root = sketchRoot()): boolean {
  return existsSync(path.join(root, "index.html"));
}
