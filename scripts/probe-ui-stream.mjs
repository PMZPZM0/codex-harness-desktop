import assert from "node:assert/strict";

const targets = await fetch(`http://127.0.0.1:${process.env.CODEX_HARNESS_DEBUG_PORT || 9223}/json`).then((r) => r.json());
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

const state = await evaluate(`window.codex.request("model/list", {}).then(r => JSON.stringify(r).slice(0, 200)).catch(e => "ERR " + e.message)`);
console.log("model/list:", state);

const custom = await evaluate(`window.codex.getCustomModel().then(r => JSON.stringify(r)).catch(e => "ERR " + e.message)`);
console.log("customModel:", custom);

// 发一条消息并轮询 20 秒看有没有 assistant 输出
await evaluate(`(() => {
  document.querySelector(".new-thread")?.click();
  const textarea = document.querySelector(".composer textarea");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(textarea, "Reply with exactly OK.");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector(".composer").requestSubmit();
})()`);
for (let i = 0; i < 10; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const snap = await evaluate(`({
    running: Boolean(document.querySelector(".stop-button")),
    assistant: (document.querySelector(".assistant-message")?.innerText ?? "").slice(0, 200),
    notice: document.querySelector(".notice")?.innerText ?? "",
    errTurn: document.querySelector(".turn-error")?.innerText ?? "",
  })`);
  console.log(`t=${(i + 1) * 2}s`, JSON.stringify(snap));
  if (snap.assistant || snap.notice || snap.errTurn) break;
}
socket.close();
