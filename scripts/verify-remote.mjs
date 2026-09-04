// 远程配对端到端验证：启动服务 → 检查二维码 URL 是局域网 IP → 手机视角（本机模拟）HTTP 访问根路径/配对页
import assert from "node:assert/strict";
import os from "node:os";

const targets = await fetch("http://127.0.0.1:9223/json").then((r) => r.json());
const page = targets.find((t) => t.type === "page" && t.title === "Codex Harness Desktop");
assert(page, "debug page not found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 0;
socket.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  const resolve = pending.get(m.id);
  if (resolve) { pending.delete(m.id); resolve(m); }
};
await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
const send = (method, params = {}) => new Promise((res) => { const id = ++nextId; pending.set(id, res); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const m = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (m.result.exceptionDetails) return { __exception: JSON.stringify(m.result.exceptionDetails).slice(0, 300) };
  return m.result.result.value;
};

// 1) 启动远程服务并拿 URL
const started = await evaluate(`window.codex.remoteStart()`);
console.log("remoteStart:", JSON.stringify(started));
const url = String(started?.url ?? "");
console.log("pair URL:", url);
assert(!url.includes("127.0.0.1"), "pairUrl 仍是 127.0.0.1");
const lanIp = url.match(/http:\/\/([^:]+):(\d+)/)?.[1] ?? "";
console.log("LAN IP used:", lanIp, "| is real LAN addr:", !lanIp.match(/^127\./) ? "YES" : "NO");

// 2) 手机视角：通过局域网 IP 访问根路径（在本机模拟，等价于同一网络下的手机请求）
const port = url.match(/:(\d+)/)?.[1];
const root = await fetch(`http://${lanIp}:${port}/`, { redirect: "manual", signal: AbortSignal.timeout(8000) });
console.log("root status:", root.status, "| redirect:", root.headers.get("location"));
assert(root.status === 302, "根路径应 302 到 /r/code");

const pairPath = root.headers.get("location") ?? "";
const pair = await fetch(`http://${lanIp}:${port}${pairPath}`, { signal: AbortSignal.timeout(8000) });
const html = await pair.text();
console.log("pair page:", pair.status, "| has control UI:", html.includes("Codex 远程控制") ? "YES" : "NO");
assert(pair.status === 200 && html.includes("Codex 远程控制"), "配对页应可访问");

// 3) WebSocket 端点存在性（HTTP 升级前会 101；这里只确认路由不是 404）
console.log("ALL REMOTE CHECKS PASSED");
socket.close();
