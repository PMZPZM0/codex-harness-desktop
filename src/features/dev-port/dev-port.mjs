/**
 * 本机测试端口的 URL 提取（10-29 用户令：「codex 打开了测试端口，自动展开右边浏览器」）。
 *
 * 数据源 = 当前会话命令执行（commandExecution）的命令行与**输出**——vite/next/serve 这类
 * dev server 起来时都会在输出里打印 `Local: http://localhost:5173/`。纯函数、无副作用，
 * 守卫直接跑真值表（scripts/guards/12ag-dev-port.mjs）。
 *
 * ⛔ 只认**带端口**的本机地址：文档/示例里裸的 `http://localhost/` 不是本机起的服务。
 * ⛔ `0.0.0.0` / `[::1]` 归一到 `127.0.0.1`（浏览器里 0.0.0.0 打不开）。
 */

/* ⛔ 路径段只吃 ASCII URL 字符：中文输出（「本地： http://localhost:5173/ 就绪」）紧跟的
   汉字不能被吞进路径 —— 上一版 `[^\s...]` 会把「 就绪」一起吸进去（真值表抓的）。 */
const LOCAL_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{1,5})?(?:\/[a-zA-Z0-9\-._~!$&'()*+,;=:@%]*)?/gi;

/** 归一一条本机 URL：剥尾部标点、0.0.0.0/::1 → 127.0.0.1；解析失败返回空串。 */
export function normalizeDevUrl(raw) {
  let url = String(raw ?? "").trim().replace(/[)\]}>.,;]+$/, "");
  if (!url) return "";
  url = url.replace("//0.0.0.0", "//127.0.0.1").replace("//[::1]", "//127.0.0.1");
  if (!/^https?:\/\//i.test(url)) url = "http://" + url.replace(/^\/+/, "");
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return "";
    return parsed.origin + (parsed.pathname === "/" ? "/" : parsed.pathname) + (parsed.search || "");
  } catch {
    return "";
  }
}

/** 从一段文本里挑出第一条**没见过**的本机服务 URL；没有返回空串。 */
export function pickDevServerUrl(text, seen) {
  const list = seen instanceof Set ? seen : new Set();
  const re = new RegExp(LOCAL_URL_RE.source, "gi");
  let match;
  while ((match = re.exec(String(text ?? ""))) !== null) {
    const url = normalizeDevUrl(match[0]);
    if (!url || list.has(url)) continue;
    /* ⛔ 必须带端口：不带端口的 localhost 是文档链接，不是这台机器上起来的服务。 */
    if (!/:\d+/.test(url)) continue;
    return url;
  }
  return "";
}
