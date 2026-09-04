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
  if (m.result.exceptionDetails) return { __exception: JSON.stringify(m.result.exceptionDetails).slice(0, 500) };
  const v = m.result.result.value;
  return typeof v === "object" && v !== null ? JSON.stringify(v).slice(0, 800) : String(v).slice(0, 800);
};

// 当前模型原样重存，触发 applyCustomModel 重写 config.toml
const current = await evaluate(`window.codex.getCustomModel()`);
console.log("current:", current);
// getCustomModel 返回的是脱敏对象（无 key），需要 provider 信息从 list 里拿原字段组合保存。
// 直接用 selectCustomModel 重新选择当前 provider 触发同样的重写路径。
const model = JSON.parse(current);
const sel = await evaluate(`window.codex.selectCustomModel(${JSON.stringify(model.provider)}).then(function(r){ return "OK " + r.name; }).catch(function(e){ return "ERR " + e.message; })`);
console.log("reselect:", sel);
await new Promise((r) => setTimeout(r, 3000));
socket.close();
