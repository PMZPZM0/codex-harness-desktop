/**
 * `orencut://` —— 按需下载的 OrenCut Studio 静态站（11-28 立）。
 *
 * 为什么另开协议：OrenCut 是**纯静态站点**（stuido.html + studio-assets + previews），
 * 里面的资源是相对/绝对路径，用 `file://` 加载时绝对路径会解析到文件系统根（全站 404）；
 * 而宿主 CSP 的 `frame-src` 只放行网络协议与已登记的自定义协议（`*` 不覆盖自定义协议，
 * 这是 pet/sketch 两起同型事故的教训）。
 *
 * ⛔ 与 `sketch:` 的关键差别：sketch 的根是**随包只读** dist/sketch，而这里的根在
 *    `<userData>/orencut`（用户可写、下载来的）⇒ **必须**做路径穿越校验，
 *    不能像 sketch 那样只靠"根不可写"这个前提。
 */
import { app } from "electron";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export const ORENCUT_SCHEME = "orencut";

/** 安装根（单一真相源：协议、状态判定、下载目标都从这里取）。 */
export function orencutRoot(): string {
  return path.join(app.getPath("userData"), "orencut");
}

/** 扩展名 → Content-Type。不在表里一律 415（⛔ 不给任意文件读取原语）。 */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

/** 把 `orencut://app/studio.html` 解析成根内文件的绝对路径；越界返回 ""。 */
export function resolveOrencutPath(requestUrl: string): string {
  let rel = "";
  try {
    rel = decodeURIComponent(new URL(requestUrl).pathname).replace(/^\/+/, "");
  } catch {
    return "";
  }
  if (!rel) rel = "studio.html";
  const root = path.resolve(orencutRoot());
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) return "";
  return target;
}

/**
 * CORS 只对「本地页面」放行（`file://` 的 Origin 是 "null"）。
 * ⛔ 为什么需要：宿主主页面是 file://，它要 fetch 本协议做存在性/元信息检查时属跨源；
 *    **远程站点**（内置浏览器里的 https 页面）origin 不是 null ⇒ 拿不到 CORS 头 ⇒ 读不到。
 * ⛔ 这不是"开个大口子"：协议本身只读、根目录只有 MIT 静态资源，且远程 origin 被排除在外。
 */
function corsHeaders(request: { headers?: { get: (name: string) => string | null } }): Record<string, string> {
  const origin = request.headers?.get?.("origin") ?? "";
  return origin === "null" || origin.startsWith("file://") ? { "access-control-allow-origin": "*" } : {};
}

/** 注册协议处理器（在 app ready 之后、与其它 protocol.handle 同处调用）。 */
export function registerOrencutProtocol(target: { handle: (scheme: string, fn: (req: { url: string; headers?: { get: (name: string) => string | null } }) => Promise<Response>) => void }): void {
  target.handle(ORENCUT_SCHEME, async (request) => {
    const file = resolveOrencutPath(request.url);
    if (!file) return new Response("Forbidden", { status: 403 });
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext];
    if (!type) return new Response("Unsupported file type", { status: 415 });
    try {
      const stat = statSync(file);
      if (!stat.isFile()) return new Response("Not found", { status: 404 });
      const total = stat.size;
      /* ⛔⛔ 11-28 修：必须支持 Range/206 —— 上游 Studio 的预览是 `<video>`，Chromium 对
         "整份 200 + 没有 accept-ranges" 的自定义协议会报 **"The element has no supported sources."**
         （用户实测：播放键点了没反应、时长显示 0.00 / 4.20）。默认 session 的 harness-media
         也是同一套 Range 口径，这里对齐。 */
      const range = request.headers?.get?.("range") ?? "";
      if (range.startsWith("bytes=")) {
        const [startRaw, endRaw] = range.slice(6).split("-");
        const start = Math.max(0, Number(startRaw) || 0);
        const end = endRaw ? Math.min(Number(endRaw), total - 1) : total - 1;
        if (start > end) return new Response("Range not satisfiable", { status: 416, headers: { "content-range": `bytes */${total}` } });
        const chunk = readFileSync(file).subarray(start, end + 1);
        return new Response(chunk, {
          status: 206,
          headers: {
            "content-type": type,
            "accept-ranges": "bytes",
            "content-range": `bytes ${start}-${end}/${total}`,
            "content-length": String(chunk.length),
            ...corsHeaders(request),
          },
        });
      }
      return new Response(readFileSync(file), {
        status: 200,
        headers: { "content-type": type, "accept-ranges": "bytes", "content-length": String(total), ...corsHeaders(request) },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
