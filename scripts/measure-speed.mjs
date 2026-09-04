// 端到端实测：新会话发消息，测首字延迟 + 总时长 + 输入 token 数
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
  return typeof v === "object" && v !== null ? JSON.stringify(v).slice(0, 900) : String(v).slice(0, 900);
};

// hook tokenUsage 以拿到本轮输入 token
await evaluate(`window.__usage = null; window.__firstDeltaAt = 0; window.__turnStart = 0;
  window.codex.onEvent(function(e){
    if (e.method === "thread/tokenUsage/updated") window.__usage = e.params && e.params.tokenUsage;
    if (e.method === "turn/started") window.__turnStart = Date.now();
    if (e.method === "item/agentMessage/delta" && !window.__firstDeltaAt) window.__firstDeltaAt = Date.now();
  });`);

const start = Date.now();
await evaluate(`(() => {
  document.querySelector(".new-thread")?.click();
  const textarea = document.querySelector(".composer textarea");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(textarea, "Reply with exactly OK.");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector(".composer").requestSubmit();
})()`);

let firstDelta = 0, completed = 0;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await evaluate(`({ fd: window.__firstDeltaAt, ts: window.__turnStart, running: Boolean(document.querySelector(".stop-button")), assistant: (document.querySelector(".assistant-message")?.innerText ?? "").slice(0, 80) })`);
  if (s.fd && !firstDelta) { firstDelta = s.fd - start; console.log(`首字: ${firstDelta}ms`); }
  if (!s.running && s.assistant) { completed = Date.now() - start; console.log(`完成: ${(completed / 1000).toFixed(1)}s 回复: ${s.assistant}`); break; }
}
const usage = await evaluate(`JSON.stringify(window.__usage && (window.__usage.last || window.__usage.total))`);
console.log("本轮 usage:", usage);
socket.close();
