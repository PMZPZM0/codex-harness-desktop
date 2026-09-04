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
  return typeof v === "object" && v !== null ? JSON.stringify(v).slice(0, 1200) : String(v).slice(0, 1200);
};

const snapshot = await evaluate(`(() => {
  const threadEl = document.querySelector(".thread, main");
  return {
    running: Boolean(document.querySelector(".stop-button")),
    assistant: (document.querySelector(".assistant-message")?.innerText ?? "").slice(0, 300),
    user: (document.querySelector(".user-message")?.innerText ?? "").slice(0, 120),
    totalDom: document.body.innerText.length,
    bodyHead: document.body.innerText.slice(0, 600),
  };
})()`);
console.log("SNAPSHOT:", snapshot);
socket.close();
