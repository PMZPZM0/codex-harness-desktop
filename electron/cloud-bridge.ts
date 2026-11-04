/**
 * 本机云同步桥（11-04）—— 让网页云管理直接驱动桌面应用上传 / 下载会话。
 *
 * 背景：网页云管理（ppz123.asia/account.html#cloud）的「立即上传 / 从云端下载」原先只认
 * 云助手的 `127.0.0.1:8917`。PPcode / Codex Harness 不跑那个服务 ⇒ 页面永远显示
 * 「本机助手未运行」。本模块在应用内起一个**只绑回环**的小 HTTP 服务，用同一套
 * `/api/*` 协议回答，页面无需再依赖云助手。
 *
 * 安全边界（三仓同一套，改这里先想清楚）：
 *   · 只绑 127.0.0.1 —— 外网 / 局域网都连不上；
 *   · 只接受账号站点 Origin（ppz123.asia / www）—— 其它网页连 CORS 预检都过不了；
 *   · 写端点不收任何令牌：身份就是**应用里已登录的云账号**，网页无法指定别的账号；
 *   · 只回同步计数与账号名，**不暴露 token / 本机路径 / 会话正文**。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type CloudBridgeOptions = {
  /** 稳定产品标识（网页据此显示应用名）：codex-harness / ppcode。 */
  product: string;
  /** 界面上显示的应用名。 */
  appName: string;
  /** 候选端口（顺序尝试，避开云助手的 8917）。 */
  ports: number[];
  machineId: () => string;
  account: () => { name: string; baseUrl: string } | null;
  syncNow: () => Promise<Record<string, unknown>>;
  syncPull: (ids: string[]) => Promise<Record<string, unknown>>;
  focusApp: () => void;
};

/* 账号站点白名单。自建部署换了域名时用 HARNESS_CLOUD_BRIDGE_ORIGINS 追加（逗号分隔）；
   ⛔ 默认只放官方账号站点 —— 别的网页连 CORS 预检都过不了。 */
const ALLOWED_ORIGINS = (() => {
  const list = ["https://ppz123.asia", "https://www.ppz123.asia", "http://ppz123.asia"];
  for (const entry of String(process.env.HARNESS_CLOUD_BRIDGE_ORIGINS || "").split(",")) {
    const origin = entry.trim().replace(/\/+$/, "");
    if (origin && !list.includes(origin)) list.push(origin);
  }
  return list;
})();
const MAX_BODY = 64 * 1024;

function corsFor(origin: string | undefined): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    /* Chrome 从公网页面连回环会发私有网络预检，缺这个头会被拦（云助手 headless 同款）。 */
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function send(res: ServerResponse, status: number, body: unknown, cors: Record<string, string>): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors })
    .end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((done) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) req.destroy();
    });
    req.on("end", () => done(raw));
    req.on("error", () => done(raw));
  });
}

/** 把同步结果里的技术原因翻成人话（页面直接展示 reason）。 */
function humanReason(reason: unknown): string {
  const code = String(reason || "");
  if (code === "not-paired" || code === "not-logged-in") return "应用未登录云账号";
  if (code === "unauthorized") return "云账号登录已失效，请在应用里重新登录";
  if (code === "unreachable") return "账号服务不可达";
  if (code === "index-http-401") return "云账号登录已失效，请在应用里重新登录";
  if (code === "index-http-403") return "云端会话同步已关闭或未开通";
  if (code.startsWith("index-http-")) return "读取云端会话列表失败";
  return code;
}

async function route(req: IncomingMessage, res: ServerResponse, opts: CloudBridgeOptions): Promise<void> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const origin = req.headers.origin;
  const cors = corsFor(origin);

  if (req.method === "OPTIONS") {
    if (!cors["Access-Control-Allow-Origin"]) send(res, 403, { ok: false, error: "origin-not-allowed" }, {});
    else res.writeHead(204, cors).end();
    return;
  }
  /* 浏览器跨源请求必带 Origin；带了但不在白名单 = 直接拒（CORS 头也不会回）。 */
  if (origin && !cors["Access-Control-Allow-Origin"]) {
    send(res, 403, { ok: false, error: "origin-not-allowed" }, {});
    return;
  }

  const account = opts.account();

  if (url.pathname === "/api/health" && req.method === "GET") {
    send(res, 200, { ok: true, product: opts.product, appName: opts.appName, protocolVersion: 1, machineId: opts.machineId() }, cors);
    return;
  }
  if (url.pathname === "/api/cloud-state" && req.method === "GET") {
    send(res, 200, {
      ok: true,
      kind: "desktop-app",
      product: opts.product,
      appName: opts.appName,
      gated: false,
      paired: Boolean(account),
      machinePaired: Boolean(account),
      machineAccounts: account ? [account.name] : [],
      account: account ? { name: account.name } : null,
      hasDeviceToken: false,
      serverReachable: true,
      plan: "A",
      cloudFeatures: { sessionIndex: true, cloudExec: false },
      machineId: opts.machineId(),
    }, cors);
    return;
  }
  if (url.pathname === "/api/sync-now" && req.method === "POST") {
    if (!account) { send(res, 200, { ok: false, result: { ok: false, reason: "not-logged-in" } }, cors); return; }
    try {
      const result = await opts.syncNow();
      send(res, 200, { ok: true, result: { ...result, reason: humanReason(result.reason) || undefined } }, cors);
    } catch (error) {
      send(res, 200, { ok: false, result: { ok: false, reason: String((error as Error)?.message || error).slice(0, 200) } }, cors);
    }
    return;
  }
  if (url.pathname === "/api/sync-pull" && req.method === "POST") {
    const raw = await readBody(req);
    let ids: string[] = [];
    try {
      const body = JSON.parse(raw || "{}") as { ids?: unknown };
      if (Array.isArray(body.ids)) ids = body.ids.map(String).filter(Boolean);
    } catch { /* 空 body = 拉全部 */ }
    if (!account) { send(res, 200, { ok: false, result: { ok: false, reason: "not-logged-in", pulled: 0, skipped: 0, failed: 0 } }, cors); return; }
    try {
      const result = await opts.syncPull(ids);
      send(res, 200, { ok: Boolean(result.ok), result: { ...result, reason: humanReason(result.reason) || undefined } }, cors);
    } catch (error) {
      send(res, 200, { ok: false, result: { ok: false, reason: String((error as Error)?.message || error).slice(0, 200), pulled: 0, skipped: 0, failed: 0 } }, cors);
    }
    return;
  }
  if (url.pathname === "/api/open-auth" && req.method === "POST") {
    opts.focusApp();
    send(res, 200, { ok: true }, cors);
    return;
  }
  send(res, 404, { ok: false, error: "not-found" }, cors);
}

/**
 * 启动本机桥。端口按顺序尝试；全被占用时返回 null（不抛、不影响应用启动）。
 * 返回的清理函数用于域释放时关掉监听。
 */
export function startCloudBridge(opts: CloudBridgeOptions): (() => void) | null {
  let current: Server | null = null;
  let closed = false;
  const close = () => {
    closed = true;
    try { current?.close(); } catch { /* 已关 */ }
    current = null;
  };
  const tryListen = (index: number) => {
    if (closed) return;
    if (index >= opts.ports.length) {
      console.warn(`[cloud-bridge] ${opts.appName}：候选端口全被占用，网页云管理无法联动`);
      return;
    }
    const server = createServer((req, res) => { void route(req, res, opts); });
    server.once("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      try { server.close(); } catch { /* 忽略 */ }
      if (code === "EADDRINUSE") tryListen(index + 1);
      else console.warn(`[cloud-bridge] ${opts.appName} 启动失败：${(error as Error).message}`);
    });
    server.listen(opts.ports[index], "127.0.0.1", () => {
      if (closed) { try { server.close(); } catch { /* 忽略 */ } return; }
      current = server;
      console.log(`[cloud-bridge] ${opts.appName} 已监听 127.0.0.1:${opts.ports[index]}`);
    });
  };
  tryListen(0);
  return close;
}
