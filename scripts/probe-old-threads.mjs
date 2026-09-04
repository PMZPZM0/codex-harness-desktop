// 打开侧栏里第一个旧会话，看消息 footer 是否有 token 行
import assert from "node:assert/strict";

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
  if (m.result.exceptionDetails) return { __exception: JSON.stringify(m.result.exceptionDetails).slice(0, 400) };
  const v = m.result.result.value;
  return typeof v === "object" && v !== null ? JSON.stringify(v).slice(0, 1500) : String(v).slice(0, 1500);
};

// 引擎侧：拉取最老的几个线程
const threads = await evaluate(`window.codex.request("thread/list", { limit: 30, sortKey: "updated_at", sortDirection: "asc" }).then(function(r){ return JSON.stringify((r.data || []).map(function(t){ return { id: t.id, name: t.name, preview: t.preview }; })); }).catch(function(e){ return "ERR " + e.message; })`);
console.log("OLDEST THREADS:", threads);
socket.close();
