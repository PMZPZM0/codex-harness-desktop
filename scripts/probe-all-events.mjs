// 抓取 harness 引擎的 stderr：主进程把 stderr 转成 kind:"log" 事件，渲染层丢弃了。
// 这里在渲染层 hook 事件总线之前，先用 CDP 直接访问 preload 通道没有 stderr；
// 改为读取主进程 console——不行。最直接：注入一个记录所有事件的 hook（含 log），需要主进程配合。
// 最终方案：重新 hook onEvent（渲染层拿到的事件里 kind=log 存在与否未知），先全部记录 10 秒。
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
  return typeof v === "object" && v !== null ? JSON.stringify(v).slice(0, 600) : v;
};

// 发消息并盯 thread/status 与 error 事件 + 卡住时的 turn 状态
await evaluate(`window.__all = [];
  window.codex.onEvent(function(e){ window.__all.push({ k: e.kind, m: e.method || "", msg: String(e.message || (e.params && (e.params.error && e.params.error.message || e.params.message)) || "").slice(0,200) }); });`);

await evaluate(`(() => {
  document.querySelector(".new-thread")?.click();
  const textarea = document.querySelector(".composer textarea");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(textarea, "Reply with exactly OK.");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector(".composer").requestSubmit();
})()`);

await new Promise((r) => setTimeout(r, 30000));
const all = await evaluate(`window.__all.map(function(e){ return e.k + ":" + e.m + (e.msg ? ":" + e.msg : ""); }).join(" || ")`);
console.log("ALL EVENTS (30s):\n" + all);
socket.close();
