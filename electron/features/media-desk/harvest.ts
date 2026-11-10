/**
 * 自媒体工作台 · 链接采集（11-09 接入 dsh-media-desk 的 harvest，MIT）。
 *
 * 抓公开网页的 title / description / og:image，用于灵感卡片预览。
 * ⛔ SSRf 闸：只许 http(s) 公网地址 —— 拒绝 localhost、内网段、`.local`、带账号密码的 URL，
 *   否则渲染层（或以后模型给的链接）就能借主进程打内网。
 * ⛔ 超时 15s、正文最多取 2MB；解析失败只回 title=域名，不报"网页坏了"。
 */
export type HarvestResult = { ok: boolean; url?: string; title?: string; desc?: string; image?: string; error?: string };

const PRIVATE_HOST = /^(localhost|.*\.local|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\]|::1)/i;
const PRIVATE_172 = /^172\.(1[6-9]|2\d|3[01])\./;

/** 只放行公网 http(s)（导出给测试/守卫共用）。 */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(String(raw ?? "").trim()); } catch { throw new Error("链接格式不对（要 http/https 开头）"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("只支持 http / https 链接");
  if (url.username || url.password) throw new Error("链接里不能带账号密码");
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST.test(host) || PRIVATE_172.test(host)) throw new Error("不能采集本机 / 内网地址");
  return url;
}

function meta(html: string, patterns: RegExp[]): string {
  for (const re of patterns) {
    const hit = re.exec(html);
    const value = String(hit?.[1] ?? "").trim();
    if (value) return value;
  }
  return "";
}

/** 抓取链接元信息；失败也返回 ok:false + 中文原因（⛔ 不抛给 IPC 让渲染层自己猜）。 */
export async function harvest(urlText: string): Promise<HarvestResult> {
  let url: URL;
  try { url = assertPublicUrl(urlText); } catch (error: any) { return { ok: false, error: String(error?.message ?? error) }; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; MediaDesk/1.0)", accept: "text/html,application/xhtml+xml" },
    });
    if (!res.ok) return { ok: false, url: url.toString(), error: `网页返回 HTTP ${res.status}` };
    const html = (await res.text()).slice(0, 2 * 1024 * 1024);
    const title = meta(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
    ]).replace(/\s+/g, " ").trim();
    const desc = meta(html, [
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    ]).replace(/\s+/g, " ").trim().slice(0, 300);
    const imageRaw = meta(html, [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    ]);
    let image = "";
    if (imageRaw) {
      try { image = new URL(imageRaw, url).toString(); } catch { image = ""; }
    }
    return { ok: true, url: url.toString(), title: title || url.hostname, desc, image };
  } catch (error: any) {
    if (error?.name === "AbortError") return { ok: false, url: url.toString(), error: "抓取超时（15 秒）" };
    return { ok: false, url: url.toString(), error: `抓取失败：${String(error?.message ?? error).slice(0, 160)}` };
  } finally {
    clearTimeout(timer);
  }
}
