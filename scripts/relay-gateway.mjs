/**
 * 手机远控的中转网关（部署在服务器，10-29）。
 *
 * 背景：以前每台电脑都要人工装 frpc + 在服务器手工配一条通道 ⇒ 只有开发者能用。
 * 现在改成「App 内置隧道 + 网关按设备 ID 路由」：
 *   · 电脑端 App 主动连 `GET /tunnel`（WebSocket），带上本机随机生成的设备 ID + 令牌；
 *   · 手机访问 `https://<域名>/t/<设备ID>/...`，网关把请求经那条 WebSocket 转给电脑端，
 *     电脑端再请求本机 17891，把响应原路带回。
 *   ⛔ 不依赖 frp / cloudflared；一台 App 装完就能用，重启后 ID 不变。
 *
 * 安全：
 *   · TOFU 绑定：设备 ID 第一次出现时把令牌哈希记下来，之后令牌不一致直接拒（防冒用 ID）；
 *   · 只允许 `/t/<id>/` 前缀路由，不能借网关访问别处；
 *   · 每设备并发/每分钟请求数都有上限，body 有上限（手机只读、上传最多 8MB）。
 *
 * 部署：`node scripts/relay-gateway.mjs`（默认 127.0.0.1:18700），前置 Caddy/nginx 终止 TLS。
 *   /t/ 前缀以外的一切请求原样转给 LEGACY_TARGET（默认 127.0.0.1:18092 = 旧的 frp 通道），
 *   保证老二维码/老 APK 仍然可用。
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.RELAY_PORT || 18700);
const HOST = process.env.RELAY_HOST || "127.0.0.1";
const LEGACY_TARGET = process.env.RELAY_LEGACY_TARGET || "127.0.0.1:18092";
/* 默认落系统临时目录：本地跑测试时别把设备表写进仓库根（服务器用 RELAY_STATE 指到 /var/lib/relay） */
const STATE_FILE = process.env.RELAY_STATE || path.join(os.tmpdir(), "relay-devices.json");
const DEVICE_RE = /^[a-z0-9]{8,24}$/;
const MAX_BODY = 32 * 1024 * 1024;
const REQ_TIMEOUT_MS = 20_000;   // 隧道半死时别让手机干等 35s
const MAX_INFLIGHT = 32;
const MAX_PER_MINUTE = 900;
/* 安装包公开下载（不要求已配对）：老版本 App 的「安装包」入口坏了，也能用手机浏览器更新 */
const APK_URL = process.env.RELAY_APK_URL
  || "https://github.com/PMZPZM0/codex-harness-desktop/releases/download/mobile-remote-v0.1.2/CodexRemote-0.1.2.apk";
/* 安装包**由网关自己缓存后再发**：国内手机直连 GitHub Release 经常超时（实测 302 过去就挂），
   ⛔ 不要退回「302 到 GitHub」——那等于把可用性交给墙。镜像顺序与 gh-mirror.ts 同源。 */
const APK_DIR = process.env.RELAY_APK_DIR || "/var/lib/relay/apk";
let apkFetching = null;
function apkCandidates() {
  return [
    "https://gh-proxy.com/" + APK_URL,
    "https://ghfast.top/" + APK_URL,
    APK_URL,
  ];
}
async function ensureApkFile() {
  const file = path.join(APK_DIR, path.basename(new URL(APK_URL).pathname));
  try { const info = fs.statSync(file); if (info.size > 1024 * 1024) return file; } catch { /* 需要下载 */ }
  if (apkFetching) return apkFetching;
  apkFetching = (async () => {
    let lastError = "未知错误";
    for (const url of apkCandidates()) {
      try {
        const response = await fetch(url, { redirect: "follow" });
        if (!response.ok) { lastError = `HTTP ${response.status}`; continue; }
        const buffer = Buffer.from(await response.arrayBuffer());
        /* 镜像挂了常回一个 HTML 错误页：小于 1MB 的「APK」一定是假的 */
        if (buffer.length < 1024 * 1024) { lastError = "下载内容太小，疑似镜像失败"; continue; }
        fs.mkdirSync(APK_DIR, { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, buffer);
        fs.renameSync(tmp, file);
        return file;
      } catch (error) {
        lastError = String(error?.message ?? error);
      }
    }
    throw new Error("安装包下载失败（镜像与直连都试过了）：" + lastError);
  })().finally(() => { apkFetching = null; });
  return apkFetching;
}
async function serveApk(req, res) {
  try {
    const file = await ensureApkFile();
    const buffer = fs.readFileSync(file);
    const name = path.basename(file);
    const range = String(req.headers.range ?? "");
    const matchRange = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (matchRange) {
      const start = Number(matchRange[1]);
      const end = matchRange[2] ? Number(matchRange[2]) : buffer.length - 1;
      const slice = buffer.subarray(start, end + 1);
      res.writeHead(206, {
        "content-type": "application/vnd.android.package-archive",
        "content-length": String(slice.length),
        "content-range": `bytes ${start}-${end}/${buffer.length}`,
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "public, max-age=600",
        "accept-ranges": "bytes",
      });
      res.end(slice);
      return;
    }
    res.writeHead(200, {
      "content-type": "application/vnd.android.package-archive",
      "content-length": String(buffer.length),
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "public, max-age=600",
      "accept-ranges": "bytes",
    });
    res.end(buffer);
  } catch (error) {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8", "retry-after": "5" });
    res.end("安装包暂时取不到：" + String(error?.message ?? error));
  }
}

/** id → { tokenHash, connectedAt, lastSeen } */
const devices = new Map();
/** id → { ws, inflight, windowStart, windowCount, pending: Map<reqId, {resolve}> } */
const tunnels = new Map();
let seq = 0;

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    for (const [id, entry] of Object.entries(raw?.devices ?? {})) {
      if (DEVICE_RE.test(id) && typeof entry?.tokenHash === "string") devices.set(id, entry);
    }
  } catch { /* 首次运行：没有状态文件 */ }
}
function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ version: 1, devices: Object.fromEntries(devices) }, null, 2));
  } catch (error) {
    console.warn("[relay] 保存设备表失败：", error?.message ?? error);
  }
}
const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

function reply(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

/** 老路径（非 /t/）原样转给旧通道：保证已发出去的二维码/老 APK 不受影响 */
function proxyLegacy(req, res) {
  const [host, port] = String(LEGACY_TARGET).split(":");
  const upstream = http.request({ host, port: Number(port), method: req.method, path: req.url, headers: { ...req.headers, host: req.headers.host } }, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.on("error", (error) => reply(res, 502, "旧通道不可用：" + error.message));
  req.pipe(upstream);
}

function isHopByHop(name) {
  return /^(connection|keep-alive|transfer-encoding|upgrade|proxy-.*|te|trailer)$/i.test(name);
}

async function handleTunnelRequest(id, restPath, req, res) {
  const tunnel = tunnels.get(id);
  if (!tunnel || tunnel.ws.readyState !== 1) {
    res.setHeader("retry-after", "3");
    reply(res, 502, "这台电脑现在不在线（手机远控服务没启动，或电脑断网）。请打开电脑端应用后重试。", "text/plain; charset=utf-8");
    return;
  }
  const now = Date.now();
  if (now - tunnel.windowStart > 60_000) { tunnel.windowStart = now; tunnel.windowCount = 0; }
  tunnel.windowCount += 1;
  if (tunnel.windowCount > MAX_PER_MINUTE) { reply(res, 429, "请求太频繁，请稍后再试。"); return; }
  if (tunnel.inflight >= MAX_INFLIGHT) { reply(res, 429, "这台电脑正忙，请稍后再试。"); return; }

  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) { reply(res, 413, "请求体太大"); return; }
      chunks.push(chunk);
    }
  } catch {
    /* 手机中途断网/取消：请求体读不完。⛔ 不接住会变成 unhandled rejection（进程级告警） */
    try { reply(res, 400, "请求被中断"); } catch { /* 连接已断 */ }
    return;
  }
  const body = Buffer.concat(chunks);
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (isHopByHop(name) || value == null) continue;
    headers[name] = Array.isArray(value) ? value.join(", ") : String(value);
  }

  const reqId = String(++seq);
  tunnel.inflight += 1;
  try {
    const replyFrame = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { tunnel.pending.delete(reqId); reject(new Error("电脑端响应超时")); }, REQ_TIMEOUT_MS);
      tunnel.pending.set(reqId, {
        resolve: (frame) => { clearTimeout(timer); tunnel.pending.delete(reqId); resolve(frame); },
      });
      try {
        tunnel.ws.send(JSON.stringify({
          type: "req",
          reqId,
          method: req.method,
          path: restPath,
          headers,
          body: body.length ? body.toString("base64") : "",
        }));
      } catch (error) {
        /* 刚判断在线、发送时连接已断：立刻失败，别让手机等满 35s 超时 */
        clearTimeout(timer);
        tunnel.pending.delete(reqId);
        reject(new Error("电脑端连接已断开"));
      }
    });
    if (replyFrame.type === "reserr") { reply(res, 502, "电脑端处理失败：" + String(replyFrame.error ?? "")); return; }
    const outHeaders = {};
    for (const [name, value] of Object.entries(replyFrame.headers ?? {})) {
      if (isHopByHop(name)) continue;
      let next = Array.isArray(value) ? value.join(", ") : String(value);
      /* 跳转 Location 与 Cookie 都要带上 /t/<id> 前缀：否则手机跳出中转前缀、或两台电脑的 cookie 互相覆盖 */
      if (/^location$/i.test(name) && next.startsWith("/")) next = `/t/${id}${next}`;
      outHeaders[name] = next;
    }
    const cookies = replyFrame.headers?.["set-cookie"];
    if (cookies) {
      const list = Array.isArray(cookies) ? cookies : [cookies];
      outHeaders["set-cookie"] = list.map((line) => String(line).replace(/;\s*Path=\/(?=;|$)/i, `; Path=/t/${id}`));
    }
    res.writeHead(Number(replyFrame.status) || 200, outHeaders);
    res.end(replyFrame.body ? Buffer.from(replyFrame.body, "base64") : Buffer.alloc(0));
  } catch (error) {
    reply(res, 502, "中转失败：" + (error?.message ?? error));
  } finally {
    tunnel.inflight = Math.max(0, tunnel.inflight - 1);
  }
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/apk" || url.startsWith("/apk?")) {
    void serveApk(req, res);
    return;
  }
  const match = url.match(/^\/t\/([a-z0-9]{8,24})(\/.*)?$/);
  if (match) {
    const id = match[1];
    const rest = match[2] || "/";
    void handleTunnelRequest(id, rest, req, res);
    return;
  }
  proxyLegacy(req, res);
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = req.url ?? "";
  if (!url.startsWith("/tunnel")) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", (ws, req) => {
  /* ⛔ 令牌走**连接后的第一帧**（hello），不放查询串：查询串会进 Caddy/nginx 访问日志 */
  const url = new URL(req.url ?? "/tunnel", "http://relay");
  const id = String(url.searchParams.get("id") ?? "").trim();
  if (!DEVICE_RE.test(id)) { ws.close(4001, "bad id"); return; }
  const authTimer = setTimeout(() => { try { ws.close(4002, "hello timeout"); } catch { /* 忽略 */ } }, 5000);
  let tunnel = null;

  ws.on("message", (raw) => {
    let frame;
    try { frame = JSON.parse(String(raw)); } catch { return; }
    if (!tunnel) {
      /* 第一帧必须是 hello：令牌只存哈希，TOFU 绑定（首次认领后 ID 不可被他人冒用） */
      const token = String(frame?.token ?? "");
      if (frame?.type !== "hello" || !DEVICE_RE.test(id) || token.length < 16) { ws.close(4001, "bad hello"); return; }
      const tokenHash = sha256(token);
      const known = devices.get(id);
      if (known && known.tokenHash !== tokenHash) {
        console.warn(`[relay] 设备 ${id} 令牌不匹配，拒绝连接`);
        ws.close(4003, "token mismatch");
        return;
      }
      if (!known) {
        devices.set(id, { tokenHash, connectedAt: Date.now(), lastSeen: Date.now() });
        saveState();
        console.log(`[relay] 新设备 ${id} 首次绑定`);
      }
      clearTimeout(authTimer);
      const previous = tunnels.get(id);
      if (previous) { try { previous.ws.close(4004, "replaced"); } catch { /* 忽略 */ } }
      tunnel = { ws, inflight: 0, windowStart: Date.now(), windowCount: 0, pending: new Map() };
      tunnels.set(id, tunnel);
      console.log(`[relay] 设备 ${id} 已上线（在线 ${tunnels.size} 台）`);
      try { ws.send(JSON.stringify({ type: "ready", id })); } catch { /* 忽略 */ }
      /* 心跳：网关主动 ping，60s 内没有 pong 就判半死并踢掉 —— 否则请求会被投进死连接干等到超时 */
      let lastPong = Date.now();
      ws.on("pong", () => { lastPong = Date.now(); });
      const beat = setInterval(() => {
        if (tunnel.ws !== ws) { clearInterval(beat); return; }
        if (Date.now() - lastPong > 60_000) { clearInterval(beat); try { ws.terminate(); } catch { /* 忽略 */ } return; }
        try { ws.ping(); } catch { /* 忽略 */ }
      }, 25_000);
      ws.on("close", () => clearInterval(beat));
      return;
    }
    if (frame?.type === "res" || frame?.type === "reserr") {
      const waiter = tunnel.pending.get(String(frame.reqId));
      if (waiter) waiter.resolve(frame);
    } else if (frame?.type === "ping") {
      try { ws.send(JSON.stringify({ type: "pong" })); } catch { /* 忽略 */ }
    }
  });
  ws.on("close", () => {
    clearTimeout(authTimer);
    if (!tunnel) return;
    if (tunnels.get(id) === tunnel) tunnels.delete(id);
    for (const waiter of tunnel.pending.values()) waiter.resolve({ type: "reserr", error: "电脑端连接断开" });
    tunnel.pending.clear();
    console.log(`[relay] 设备 ${id} 已离线（在线 ${tunnels.size} 台）`);
  });
  ws.on("error", (error) => console.warn(`[relay] 设备 ${id} 连接异常：`, error?.message ?? error));
});

loadState();
server.listen(PORT, HOST, () => {
  console.log(`[relay] listening ${HOST}:${PORT}（legacy → ${LEGACY_TARGET}）`);
});
