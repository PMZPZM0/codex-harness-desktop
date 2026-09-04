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
  if (m.result.exceptionDetails) return { __exception: m.result.exceptionDetails };
  return m.result.result.value;
};

// 1) 带真实 Key 的供应商连通性测试
const probe = await evaluate(`window.codex.probeCustomModel(await window.codex.getCustomModel()).then(r => JSON.stringify(r)).catch(e => "ERR " + e.message)`);
console.log("provider probe:", String(probe).slice(0, 500));

// 2) 上一轮测试消息最终状态（等 60 秒看会不会出错）
const finalState = await evaluate(`(async () => {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const el = document.querySelector(".assistant-message, .notice, .turn-error, .error");
    const running = Boolean(document.querySelector(".stop-button"));
    if ((el && el.innerText) || !running) return { running, text: el?.innerText?.slice(0, 300) ?? "", waited: (i + 1) * 2 };
  }
  return { running: true, text: "", waited: 60 };
})()`);
console.log("final state:", JSON.stringify(finalState));
socket.close();
