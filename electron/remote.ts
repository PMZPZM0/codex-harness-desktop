// Remote mobile control: local HTTP/WebSocket pairing server + Cloudflare quick tunnel.
// 二维码指向 https 隧道域名（微信/相机可直接打开）；隧道不可用时回退本机 IPv6/局域网地址。
import http from "node:http";
import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type RemoteEvents = {
  getStatus?: () => string;
  sendCommand?: (cmd: string) => void;
  onDeviceConnected?: (device: { id: string; name: string }) => void;
  onCommand?: (command: string, device: { id: string; name: string }) => void;
  /** 手机端对话 UI 需要的引擎桥：会话列表 / 读取某会话消息 / 新建会话 / 向某会话发消息 */
  listThreads?: () => Promise<{ id: string; name: string; preview: string; updatedAt: number }[]>;
  getThreadMessages?: (threadId: string) => Promise<{ role: "user" | "assistant" | "system"; text: string }[]>;
  newThread?: () => Promise<{ id: string }>;
  sendMessage?: (threadId: string, text: string) => Promise<void>;
  /** 引擎流式事件转发给已连接手机（turn 增量） */
  onThreadEvent?: (listener: (event: { threadId: string; kind: string; text: string }) => void) => () => void;
  /** 设备会话记忆持久化文件（userData/remote-sessions.json）；不传则不持久化 */
  storageFile?: string;
};

type Device = {
  id: string;
  name: string;
  code: string;
  connectedAt: number;
  lastSeen: number;
  socket: any;
};

/** 机器人绑定会话：扫码 → 手机确认 → 应用侧标记已绑定 */
type BindSession = {
  botId: string;
  code: string;
  status: "waiting" | "confirmed" | "expired";
  createdAt: number;
  deviceName?: string;
};

export class RemoteControlService {
  private server: http.Server | null = null;
  private port = 0;
  private devices = new Map<string, Device>();
  private bindSessions = new Map<string, BindSession>();
  private tunnelProc: ChildProcess | null = null;
  private tunnelUrl = "";
  private events: RemoteEvents;
  private storageFile: string;
  /** 设备（手机端 localStorage 生成的 deviceId）→ 上次使用的会话 threadId */
  private deviceThreads = new Map<string, string>();

  constructor(opts: RemoteEvents) {
    this.events = opts;
    this.storageFile = opts.storageFile ?? "";
    this.loadDeviceThreads();
  }

  private loadDeviceThreads() {
    if (!this.storageFile) return;
    try {
      const raw = fs.readFileSync(this.storageFile, "utf8");
      const data = JSON.parse(raw);
      if (data && typeof data === "object") {
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === "string") this.deviceThreads.set(key, value);
        }
      }
    } catch { /* 首次运行无文件 */ }
  }

  private saveDeviceThreads() {
    if (!this.storageFile) return;
    try {
      fs.mkdirSync(path.dirname(this.storageFile), { recursive: true });
      fs.writeFileSync(this.storageFile, JSON.stringify(Object.fromEntries(this.deviceThreads), null, 2), "utf8");
    } catch { /* 写盘失败忽略 */ }
  }

  async start(port = 0) {
    if (this.server) return this.port;
    this.port = port;
    this.server = http.createServer((req, res) => this.route(req, res));
    await new Promise<void>((resolve) => {
      // 双栈监听 [::]（同时接受 IPv4 映射连接）：本机有公网 IPv6 时手机蜂窝网络可直连，
      // 没有时退化为同一 Wi-Fi 内 IPv4 访问——两种场景都覆盖
      this.server!.listen(this.port, "::", () => {
        this.port = (this.server!.address() as any).port;
        console.log(`[remote] listening on [::]:${this.port} (dual stack)`);
        resolve();
      });
    });
    this.ensureFirewall();
    this.startTunnel();
    // 订阅引擎流式事件 → 推给手机对话页（含轮询缓冲）
    this.events.onThreadEvent?.((event) => this.broadcastThreadEvent(event));
    return this.port;
  }

  /** Cloudflare 快速隧道（零注册）：给配对服务一个 https://xxx.trycloudflare.com 公网域名，
   * 微信/相机扫码可直接打开。失败静默回退本机地址。 */
  private startTunnel() {
    const bin = path.join(process.cwd(), "resources", "tools", "cloudflared.exe");
    if (!fs.existsSync(bin)) return;
    try { this.tunnelProc?.kill(); } catch { /* not running */ }
    const child = spawn(bin, ["tunnel", "--url", `http://127.0.0.1:${this.port}`, "--edge-ip-version", "auto"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    this.tunnelProc = child;
    const grab = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) this.tunnelUrl = match[0];
    };
    child.stdout?.on("data", grab);
    child.stderr?.on("data", grab);
    child.on("exit", () => { this.tunnelProc = null; this.tunnelUrl = ""; });
    // 5 秒后若仍无域名，大概率被墙或网络不通，杀掉进程避免资源浪费
    setTimeout(() => {
      if (!this.tunnelUrl && this.tunnelProc === child) {
        try { child.kill(); } catch { /* noop */ }
        this.tunnelProc = null;
      }
    }, 5_000);
  }

  /** 配对地址：优先 https 隧道域名（微信可直接打开）；隧道不可用时只回退局域网 IPv4
   * 地址（同一 Wi-Fi 下微信可打开）。绝不回退 IPv6 地址——微信内置浏览器会拦截纯 IP。 */
  private externalBase() {
    if (this.tunnelUrl) return this.tunnelUrl;
    const v4 = this.lanV4Address();
    if (v4) return `http://${v4}:${this.port}`;
    return "";
  }

  /** 局域网 IPv4 地址（微信在同一 Wi-Fi 下可访问） */
  private lanV4Address() {
    const os = require("node:os");
    for (const list of Object.values(os.networkInterfaces())) {
      for (const entry of list as any[]) {
        if (entry.family === "IPv4" && !entry.internal) return entry.address;
      }
    }
    return "";
  }

  /** Windows 防火墙放行本端口（幂等；失败不影响配对，只是同一网络可能被拦） */
  private ensureFirewall() {
    if (process.platform !== "win32") return;
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
    const rule = "CodexHarness-Remote";
    const check = spawn("netsh", ["advfirewall", "firewall", "show", "rule", `name=${rule}`], { windowsHide: true });
    check.on("exit", (code) => {
      if (code === 0) return;
      const add = spawn("netsh", ["advfirewall", "firewall", "add", "rule", `name=${rule}`, "dir=in", "action=allow", "protocol=TCP", `localport=${this.port}`], { windowsHide: true });
      add.on("error", () => { /* 无管理员权限时静默；用户可手动放行 */ });
    });
    check.on("error", () => { /* netsh 不可用 */ });
  }

  /** 配对地址：优先公网 IPv6（手机蜂窝网络可直连，无需同一 Wi-Fi）；没有则退局域网 IPv4 */
  lanAddress() {
    const os = require("node:os");
    const nets = Object.values(os.networkInterfaces()).flat() as any[];
    const globalV6 = nets.find((entry) => entry.family === "IPv6" && !entry.internal && /^2[0-9a-f]{3}:/.test(entry.address));
    if (globalV6) return `[${globalV6.address}]`;
    for (const list of Object.values(os.networkInterfaces())) {
      for (const entry of list as any[]) {
        if (entry.family === "IPv4" && !entry.internal) return entry.address;
      }
    }
    return os.hostname();
  }

  private html(code: string, botId?: string, botName?: string) {
    const bindingMode = Boolean(botId);
    if (bindingMode) {
      // 绑定模式：确认登录 → 确认成功后 location 换成不带 ?bot= 的对话页
      return `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>绑定机器人</title><style>
body{font-family:system-ui,sans-serif;background:#f7f7f5;margin:0;color:#23231f}
.card{background:#fff;border:1px solid #e7e7e4;border-radius:14px;padding:20px;margin:40px 16px;text-align:center}
h1{font-size:18px;margin:0 0 6px} p{color:#6f6f69;font-size:13px;line-height:1.7;margin:8px 0}
button{width:100%;margin-top:14px;padding:13px;border:0;border-radius:12px;background:#1e1e1c;color:#fff;font-size:15px;cursor:pointer}
button.ghost{background:#fff;color:#23231f;border:1px solid #d7d9d4}
.ok{color:#1a7f37;font-weight:600}
</style>
<div class="card"><h1>绑定机器人「${botName ?? ""}」</h1><p>确认后，这台手机将作为该机器人的控制端：<br>可查看对话、随时发消息，与电脑实时同步。</p><p id="state">正在校验绑定码…</p><div id="btns" style="display:none"><button onclick="doBind()">确认登录</button><button class="ghost" onclick="document.getElementById('btns').style.display='none'">取消</button></div></div>
<script>
const code = ${JSON.stringify(code)};
const botId = ${JSON.stringify(botId ?? "")};
async function check(){
  try{
    const r = await fetch("/api/bind-status?code=" + code + "&bot=" + botId);
    const j = await r.json();
    if(j.ok){ document.getElementById("state").textContent = "绑定码有效"; document.getElementById("btns").style.display = "block"; }
    else document.getElementById("state").textContent = "绑定码已失效，请回到应用重新生成二维码。";
  }catch(e){ document.getElementById("state").textContent = "网络错误：" + e.message; }
}
check();
async function doBind(){
  const r = await fetch("/api/bind-confirm", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ code, botId, deviceName: navigator.userAgent.includes("iPhone") ? "iPhone" : navigator.userAgent.includes("Android") ? "Android 手机" : "手机" }) });
  const j = await r.json();
  if (j.ok) { document.querySelector(".card").innerHTML = "<h1 class='ok'>✓ 绑定成功</h1><p>正在进入对话…</p>"; setTimeout(() => { location.href = "/r/" + code; }, 800); }
  else document.getElementById("state").textContent = "绑定失败：" + (j.error ?? "未知错误");
}
</script></html>`;
    }
    return `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Codex 对话</title><style>
*{box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#f7f7f5;margin:0;color:#23231f;display:flex;flex-direction:column;height:100vh}
header{padding:12px 16px;background:#fff;border-bottom:1px solid #e7e7e4;display:flex;align-items:center;gap:10px;flex:0 0 auto}
header h1{font-size:15px;margin:0;flex:1}
header .status{font-size:11px;color:#1a7f37;background:#e7f3ea;border-radius:10px;padding:2px 8px}
header button{flex:0 0 auto;width:auto;margin:0;padding:6px 10px;font-size:12px;background:#fff;color:#23231f;border:1px solid #d7d9d4;border-radius:8px}
#threads{position:fixed;inset:0;background:#fff;z-index:20;display:none;flex-direction:column}
#threads.open{display:flex}
#threads .list{flex:1;overflow:auto;padding:8px}
.thread-row{padding:12px;border-bottom:1px solid #f0f0ee;cursor:pointer}
.thread-row b{display:block;font-size:14px}
.thread-row small{color:#8a8a84;font-size:12px}
#msglist{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:86%;padding:10px 13px;border-radius:14px;font-size:14.5px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
.msg.user{align-self:flex-end;background:#1e1e1c;color:#fff;border-bottom-right-radius:4px}
.msg.assistant{align-self:flex-start;background:#fff;border:1px solid #e7e7e4;border-bottom-left-radius:4px}
.msg.assistant.streaming{border-color:#e8b34b}
.msg.system{align-self:center;background:transparent;color:#8a8a84;font-size:12px}
.thinking-indicator{align-self:flex-start;display:flex;align-items:center;gap:6px;padding:8px 0;color:#8a8a84;font-size:12px}
.thinking-indicator .dot{width:6px;height:6px;background:#e8b34b;border-radius:50%;animation:throb 1.2s infinite}
@keyframes throb{0%,100%{opacity:.4;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}
.empty-tip{text-align:center;color:#b0b0a8;padding:40px 16px;font-size:13px}
.thread-row.active{background:#f4f4f2}
#inputbar{flex:0 0 auto;display:flex;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid #e7e7e4;padding-bottom:calc(10px + env(safe-area-inset-bottom))}
#cmd{flex:1;padding:11px 14px;border:1px solid #d7d9d4;border-radius:12px;font-size:15px}
#send{width:auto;margin:0;padding:11px 20px;font-size:14px;border-radius:12px}
.confirm-card{margin:40vh auto 0;max-width:340px;text-align:center}
</style>
<header>
  <button id="btn-threads" onclick="toggleThreads()">会话</button>
  <h1 id="title">Codex 对话</h1>
  <span id="thread-label" style="font-size:11px;color:#8a8a84;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px"></span>
  <span class="status" id="status">连接中…</span>
</header>
<div id="threads"><div style="padding:12px 16px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center"><b>选择会话</b><button onclick="newThread()" style="margin:0">＋ 新会话</button></div><div class="list" id="thread-list"></div></div>
<div id="msglist"></div>
<div id="inputbar"><input id="cmd" placeholder="输入消息，发送给 Codex"><button id="send" onclick="sendCmd()">发送</button></div>
<script>
const code = ${JSON.stringify(code)};
const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/" + code);
let rpcSeq = 0;
const rpcWaiters = new Map();
// 会话记忆 key 固定（不绑定随机 code）：同一地址下扫码进入都能恢复上次会话
const THREAD_KEY = "chm-thread";
let currentThreadId = localStorage.getItem(THREAD_KEY) || "";
let streaming = "";
const list = document.getElementById("msglist");
// 设备身份：localStorage 固定生成，服务端用它记住「这台手机上次用的会话」
let deviceId = localStorage.getItem("chm-device-id");
if (!deviceId) {
  deviceId = "dev-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  localStorage.setItem("chm-device-id", deviceId);
}
function saveSession() {
  try {
    fetch("/api/session", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ device: deviceId, threadId: currentThreadId }) });
  } catch { /* 忽略 */ }
}

async function rpc(payload) {
  const reqId = String(++rpcSeq);
  const res = await fetch("/api/rpc", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ ...payload, reqId }) });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}
function push(role, text, cls, pending) {
  const div = document.createElement("div");
  div.className = "msg " + (cls || role);
  if (pending) div.dataset.pending = "1";
  div.textContent = text;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
  return div;
}
async function loadThreads() {
  const r = await rpc({ type: "list-threads" });
  const el = document.getElementById("thread-list");
  el.innerHTML = "";
  const threads = r.threads || [];
  if (!threads.length) {
    el.innerHTML = "<div class='empty-tip'>暂无会话，点击右上角「＋ 新会话」开始</div>";
    return;
  }
  for (const t of threads) {
    const row = document.createElement("div");
    row.className = "thread-row" + (t.id === currentThreadId ? " active" : "");
    row.innerHTML = "<b></b><small></small>";
    row.querySelector("b").textContent = t.name || t.preview || "未命名任务";
    row.querySelector("small").textContent = new Date(t.updatedAt * 1000).toLocaleString() + " · " + (t.preview || "").slice(0, 40);
    row.onclick = () => { currentThreadId = t.id; localStorage.setItem(THREAD_KEY, t.id); document.getElementById("threads").classList.remove("open"); loadMessages(); updateThreadLabel(t.name || t.preview || "未命名任务"); saveSession(); };
    el.appendChild(row);
  }
}
function toggleThreads() { const el = document.getElementById("threads"); if (el.classList.contains("open")) el.classList.remove("open"); else { loadThreads(); el.classList.add("open"); } }
function updateThreadLabel(name) {
  const el = document.getElementById("thread-label");
  if (el) el.textContent = name || "";
}
async function newThread() {
  const r = await rpc({ type: "new-thread" });
  currentThreadId = r.threadId;
  localStorage.setItem(THREAD_KEY, currentThreadId);
  document.getElementById("threads").classList.remove("open");
  list.innerHTML = "";
  push("system", "已新建会话，直接发消息开始对话");
  updateThreadLabel("新会话");
  loadThreads();
  saveSession();
}
async function loadMessages() {
  if (!currentThreadId) return;
  try {
    list.innerHTML = "";
    const r = await rpc({ type: "get-messages", threadId: currentThreadId });
    const msgs = r.messages || [];
    for (const m of msgs) push(m.role, m.text);
    if (msgs.length > 0) {
      const firstUser = msgs.find((m) => m.role === "user");
      updateThreadLabel(firstUser ? firstUser.text.slice(0, 20) : "会话");
    }
  } catch {
    // 会话已失效（被删除等）：退回新建
    currentThreadId = "";
    localStorage.removeItem(THREAD_KEY);
    await newThread();
  }
}
function sendCmd() {
  const input = document.getElementById("cmd");
  const v = input.value.trim();
  if (!v) return;
  push("user", v, "", true);
  input.value = "";
  showThinking();
  if (!currentThreadId) {
    rpc({ type: "new-thread" }).then((r) => { currentThreadId = r.threadId; localStorage.setItem(THREAD_KEY, currentThreadId); loadThreads(); return rpc({ type: "send-message", threadId: currentThreadId, text: v }); }).then(() => { updateThreadLabel(v.slice(0, 20)); saveSession(); }).catch((e) => { hideThinking(); push("system", "发送失败：" + e.message); });
  } else rpc({ type: "send-message", threadId: currentThreadId, text: v }).catch((e) => { hideThinking(); push("system", "发送失败：" + e.message); });
}
function showThinking() {
  if (list.querySelector(".thinking-indicator")) return;
  const div = document.createElement("div");
  div.className = "msg thinking-indicator";
  div.innerHTML = '<span class="dot"></span>思考中…';
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}
function hideThinking() {
  const el = list.querySelector(".thinking-indicator");
  if (el) el.remove();
}
document.getElementById("cmd").addEventListener("keydown", (e) => { if (e.key === "Enter") sendCmd(); });
let pollSince = Date.now() - 60000;
async function pollLoop() {
  try {
    const res = await fetch("/api/events?since=" + pollSince);
    const data = await res.json();
    pollSince = data.now || Date.now();
    for (const event of data.events || []) {
      if (event.threadId !== currentThreadId) continue;
      if (event.kind === "delta") {
        hideThinking();
        let el = list.querySelector(".streaming");
        if (!el) el = push("assistant", "", "assistant streaming");
        el.textContent += event.text;
        list.scrollTop = list.scrollHeight;
      } else if (event.kind === "done") {
        hideThinking();
        const el = list.querySelector(".streaming");
        if (el) el.classList.remove("streaming");
      } else if (event.kind === "user") {
        const pending = list.querySelector('.msg.user[data-pending="1"]');
        if (pending && pending.textContent === event.text) {
          delete pending.dataset.pending;
        } else {
          push("user", event.text);
        }
      }
    }
    document.getElementById("status").textContent = "● 在线";
  } catch { document.getElementById("status").textContent = "重连中…"; }
  setTimeout(pollLoop, 1500);
}
pollLoop();
(async () => {
  // 恢复上次会话：① 本地记录 ② 服务端设备映射 ③ 最近会话兜底，全无才新建
  if (currentThreadId) { await loadMessages(); saveSession(); return; }
  try {
    const r = await fetch("/api/session?device=" + deviceId);
    const j = await r.json();
    if (j.threadId) { currentThreadId = j.threadId; localStorage.setItem(THREAD_KEY, currentThreadId); await loadMessages(); saveSession(); return; }
  } catch { /* 服务不可用则走兜底 */ }
  try {
    const r = await rpc({ type: "list-threads" });
    const threads = r.threads || [];
    if (threads.length) {
      const t = threads[0];
      currentThreadId = t.id;
      localStorage.setItem(THREAD_KEY, t.id);
      await loadMessages();
      updateThreadLabel(t.name || t.preview || "未命名任务");
      saveSession();
      return;
    }
  } catch { /* 引擎不可用则新建 */ }
  await newThread();
})();
</script>`;
  }

  private route(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = req.url ?? "/";
    // WebSocket upgrade
    if (url.startsWith("/ws/") && req.headers.upgrade?.toLowerCase() === "websocket") {
      return this.handleWs(req, res);
    }
    if (url === "/api/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: this.events.getStatus?.() ?? "", devices: this.listDevices() }));
      return;
    }
    // 手机对话页轮询增量（隧道下 WebSocket 不可靠，用 HTTP 轮询同步对话流）
    if (url.startsWith("/api/events")) {
      const params = new URL(url, "http://x").searchParams;
      const since = Number(params.get("since") ?? 0);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ events: this.pollEvents(since), now: Date.now() }));
      return;
    }
    // 设备会话记忆：GET 查询某设备上次会话；POST 保存（持久化到 userData，跨扫码恢复）
    if (url.startsWith("/api/session") && req.method === "GET") {
      const params = new URL(url, "http://x").searchParams;
      const device = params.get("device") ?? "";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ threadId: device ? this.deviceThreads.get(device) ?? null : null }));
      return;
    }
    if (url.startsWith("/api/session") && req.method === "POST") {
      void this.readBody(req).then((body) => {
        try {
          const data = JSON.parse(body);
          const device = String(data.device ?? "");
          const threadId = String(data.threadId ?? "");
          if (device && threadId) { this.deviceThreads.set(device, threadId); this.saveDeviceThreads(); }
          this.json(res, 200, { ok: true });
        } catch (error: any) {
          this.json(res, 200, { ok: false, error: error.message });
        }
      });
      return;
    }
    // 手机对话页 RPC over HTTP（WebSocket 不可用时的同功能入口）
    if (url.startsWith("/api/rpc") && req.method === "POST") {
      void this.readBody(req).then(async (body) => {
        try {
          const data = JSON.parse(body);
          let result: any = {};
          if (data.type === "list-threads") result = { threads: await (this.events.listThreads?.() ?? Promise.resolve([])) };
          else if (data.type === "get-messages") result = { messages: await (this.events.getThreadMessages?.(String(data.threadId ?? "")) ?? Promise.resolve([])) };
          else if (data.type === "new-thread") result = { threadId: (await (this.events.newThread?.() ?? Promise.reject(new Error("unsupported")))).id };
          else if (data.type === "send-message") { await (this.events.sendMessage?.(String(data.threadId ?? ""), String(data.text ?? "")) ?? Promise.resolve()); result = { ok: true }; }
          else result = { error: "unknown rpc type" };
          this.json(res, 200, { reqId: data.reqId, ...result });
        } catch (error: any) {
          this.json(res, 200, { reqId: String(JSON.parse(body || "{}").reqId ?? ""), error: error.message });
        }
      });
      return;
    }
    const m = url.match(/^\/r\/([a-z0-9]+)(\?.*)?$/);
    if (m) {
      const code = m[1];
      // /r/<code>?bot=<id>&name=<名称>：机器人绑定模式
      const params = new URL(url, "http://x").searchParams;
      const botId = params.get("bot") ?? undefined;
      const botName = params.get("name") ?? undefined;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(this.html(code, botId, botName));
      return;
    }
    // 绑定会话 API：状态查询 / 手机确认
    if (url.startsWith("/api/bind-status")) {
      const params = new URL(url, "http://x").searchParams;
      const session = this.bindSessions.get(params.get("code") ?? "");
      const ok = Boolean(session && session.botId === params.get("bot") && session.status === "waiting" && Date.now() - session.createdAt < 5 * 60_000);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok }));
      return;
    }
    if (url.startsWith("/api/bind-confirm") && req.method === "POST") {
      void this.readBody(req).then((body) => {
        try {
          const data = JSON.parse(body);
          const session = this.bindSessions.get(String(data.code ?? ""));
          if (!session || session.botId !== data.botId || session.status !== "waiting" || Date.now() - session.createdAt >= 5 * 60_000) {
            this.json(res, 200, { ok: false, error: "绑定码无效或已过期" });
            return;
          }
          session.status = "confirmed";
          session.deviceName = String(data.deviceName ?? "手机");
          this.json(res, 200, { ok: true });
        } catch (error: any) {
          this.json(res, 200, { ok: false, error: error.message });
        }
      });
      return;
    }
    // 根路径（二维码扫出来的地址）：固定跳 /r/mobile —— 会话记忆 key 稳定，
    // 手机端才能跨扫码恢复上次会话（旧逻辑每次随机 code，localStorage key 对不上，历史全丢）
    if (url === "/" || url.startsWith("/?")) {
      res.writeHead(302, { Location: "/r/mobile" });
      res.end();
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  }

  // Minimal handshake-free WebSocket server (RFC6455)
  private handleWs(req: http.IncomingMessage, res: http.ServerResponse) {
    const code = (req.url ?? "").split("/")[2] ?? "";
    const key = req.headers["sec-websocket-key"] as string;
    const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    res.writeHead(101, { Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Accept": accept });
    const socket = res as any;
    const deviceId = crypto.randomUUID();
    const name = `手机设备 ${this.devices.size + 1}`;
    const device: Device = { id: deviceId, name, code, connectedAt: Date.now(), lastSeen: Date.now(), socket };
    this.devices.set(deviceId, device);
    this.events.onDeviceConnected?.({ id: deviceId, name: device.name });
    // Push status on connect
    this.send(device, JSON.stringify({ type: "status", status: this.events.getStatus?.() ?? "", devices: this.listDevices() }));
    socket.on("data", (buf: Buffer) => {
      const text = buf.toString("utf8");
      for (const frame of text.split("|")) {
        const payload = this.decodeFrame(buf, frame);
        if (payload) this.handleMessage(device, payload);
      }
    });
    socket.on("close", () => this.devices.delete(deviceId));
  }

  private decodeFrame(buf: Buffer, _frame: string) {
    // Very simplified: assume single text frame (masked). Real impl would parse opcode/length.
    if (buf.length < 6) return null;
    const len = buf[1] & 0x7f;
    if (buf.length < 6 + len) return null;
    const mask = buf.subarray(2, 6);
    const payload = buf.subarray(6, 6 + len);
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4];
    return out.toString("utf8");
  }

  private handleMessage(device: Device, msg: string) {
    device.lastSeen = Date.now();
    try {
      const data = JSON.parse(msg);
      if (data.type === "ping") return this.send(device, JSON.stringify({ type: "pong" }));
      if (data.type === "command") {
        const command = String(data.command ?? "");
        this.events.onCommand?.(command, { id: device.id, name: device.name });
        this.send(device, JSON.stringify({ type: "ack", command }));
        return;
      }
      // 手机对话 UI 的引擎桥请求（异步，回带 reqId）
      const reqId = String(data.reqId ?? "");
      const reply = (payload: any) => this.send(device, JSON.stringify({ type: "rpc", reqId, ...payload }));
      if (data.type === "list-threads") {
        void (this.events.listThreads?.() ?? Promise.resolve([])).then((threads) => reply({ threads })).catch((e) => reply({ error: e.message }));
        return;
      }
      if (data.type === "get-messages") {
        void (this.events.getThreadMessages?.(String(data.threadId ?? "")) ?? Promise.resolve([])).then((messages) => reply({ messages })).catch((e) => reply({ error: e.message }));
        return;
      }
      if (data.type === "new-thread") {
        void (this.events.newThread?.() ?? Promise.reject(new Error("not supported"))).then((thread) => reply({ threadId: thread.id })).catch((e) => reply({ error: e.message }));
        return;
      }
      if (data.type === "send-message") {
        void (this.events.sendMessage?.(String(data.threadId ?? ""), String(data.text ?? "")) ?? Promise.resolve()).then(() => reply({ ok: true })).catch((e) => reply({ error: e.message }));
        return;
      }
    } catch { /* ignore */ }
  }

  /** 把引擎流式事件推给所有已连接手机（对话实时同步）；
   * 同时落到轮询缓冲：Cloudflare 免费隧道对裸 WebSocket 握手兼容差，手机页用 HTTP 轮询兜底 */
  broadcastThreadEvent(event: { threadId: string; kind: string; text: string }) {
    this.pollBuffer.push({ ...event, at: Date.now() });
    if (this.pollBuffer.length > 400) this.pollBuffer.splice(0, this.pollBuffer.length - 400);
    const payload = JSON.stringify({ type: "thread-event", ...event });
    for (const device of this.devices.values()) this.send(device, payload);
  }

  /** 轮询增量：since 之后的 thread-event */
  pollEvents(since: number) {
    return this.pollBuffer.filter((entry) => entry.at > since);
  }
  private pollBuffer: { threadId: string; kind: string; text: string; at: number }[] = [];

  private send(device: Device, text: string) {
    const payload = Buffer.from(text, "utf8");
    const header = Buffer.from([0x81, payload.length]);
    try { device.socket.write(Buffer.concat([header, payload])); } catch { /* closed */ }
  }

  listDevices() {
    return [...this.devices.values()].map((d) => ({ id: d.id, name: d.name, code: d.code, connectedAt: d.connectedAt, lastSeen: d.lastSeen }));
  }

  /** 创建机器人绑定会话：返回绑定页 URL（二维码内容） */
  createBindSession(botId: string, botName: string) {
    const code = crypto.randomBytes(4).toString("hex");
    this.bindSessions.set(code, { botId, code, status: "waiting", createdAt: Date.now() });
    // 清理过期会话
    for (const [key, session] of this.bindSessions) if (Date.now() - session.createdAt > 10 * 60_000) this.bindSessions.delete(key);
    return `${this.pairUrl()}/r/${code}?bot=${encodeURIComponent(botId)}&name=${encodeURIComponent(botName)}`;
  }

  /** 查询绑定会话状态：waiting / confirmed / expired（找不到即 expired） */
  bindStatus(code: string): "waiting" | "confirmed" | "expired" {
    const session = this.bindSessions.get(code);
    if (!session || Date.now() - session.createdAt > 5 * 60_000) return "expired";
    return session.status;
  }

  /** 取走已确认的绑定（取后标记 waiting 复位为 consumed——用 expired 表示已消费） */
  consumeBind(code: string): { botId: string; deviceName?: string } | null {
    const session = this.bindSessions.get(code);
    if (!session || session.status !== "confirmed") return null;
    session.status = "expired";
    return { botId: session.botId, deviceName: session.deviceName };
  }

  private readBody(request: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      request.on("end", () => resolve(body));
      request.on("error", () => resolve(""));
    });
  }

  private json(response: http.ServerResponse, status: number, value: unknown) {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  }

  pairUrl() {
    // 优先 https 隧道域名（微信可直接打开），回退公网 IPv6 / 局域网 IPv4
    return this.externalBase();
  }

  stop() {
    try { this.tunnelProc?.kill(); } catch { /* not running */ }
    this.tunnelProc = null;
    this.tunnelUrl = "";
    this.server?.close();
    this.server = null;
  }
}
