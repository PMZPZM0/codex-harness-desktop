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

/** 注册协议处理器（在 app ready 之后、与其它 protocol.handle 同处调用）。 */
export function registerOrencutProtocol(target: { handle: (scheme: string, fn: (req: { url: string }) => Promise<Response>) => void }): void {
  target.handle(ORENCUT_SCHEME, async (request) => {
    const file = resolveOrencutPath(request.url);
    if (!file) return new Response("Forbidden", { status: 403 });
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext];
    if (!type) return new Response("Unsupported file type", { status: 415 });
    try {
      const stat = statSync(file);
      if (!stat.isFile()) return new Response("Not found", { status: 404 });
      return new Response(readFileSync(file), { status: 200, headers: { "content-type": type } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
