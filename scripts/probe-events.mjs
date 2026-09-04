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

await evaluate(`window.__events = []; window.__harness = [];
  window.codex.onEvent((e) => window.__events.push({ method: String(e?.method ?? ""), params: JSON.stringify(e?.params ?? {}).slice(0, 200) }));
  window.codex.onHarnessEvent?.((e) => window.__harness.push(JSON.stringify(e).slice(0, 200)));`);

await evaluate(`(() => {
  document.querySelector(".new-thread")?.click();
  const textarea = document.querySelector(".composer textarea");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(textarea, "Reply with exactly OK.");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector(".composer").requestSubmit();
})()`);

await new Promise((r) => setTimeout(r, 25000));
const events = await evaluate(`JSON.stringify(window.__events)`);
console.log("EVENTS:", events.slice(0, 4000));
const harness = await evaluate(`JSON.stringify(window.__harness)`);
console.log("HARNESS:", harness.slice(0, 1000));
socket.close();
