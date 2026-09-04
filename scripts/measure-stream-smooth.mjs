// 流式平滑实测 v2：把采样结果逐步打印，诊断为什么采样拿不到数据
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
  if (m.result.exceptionDetails) return { __exception: JSON.stringify(m.result.exceptionDetails).slice(0, 300) };
  const v = m.result.result.value;
  return v; // 原样返回，不 JSON 化
};

await evaluate(`(() => {
  document.querySelector(".new-thread")?.click();
  const textarea = document.querySelector(".composer textarea");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(textarea, "数到20，每个数字一行。");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector(".composer").requestSubmit();
})()`);

let prevLen = 0, grows = 0, shrinks = 0, samplesWithText = 0, mdSwitchAt = -1;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 400));
  const s = await evaluate(`JSON.stringify((() => {
    const plain = document.querySelector(".stream-plain");
    const agent = document.querySelector(".assistant-message");
    const card = document.querySelector(".reasoning-card");
    return {
      plainLen: plain ? plain.textContent.length : -1,
      agentLen: agent ? agent.innerText.length : -1,
      hasCard: Boolean(card),
      cardClass: card ? card.className : "",
      running: Boolean(document.querySelector(".stop-button")),
    };
  })())`);
  const o = JSON.parse(s);
  if (o.plainLen >= 0) {
    samplesWithText++;
    if (o.plainLen > prevLen) grows++;
    if (o.plainLen < prevLen) shrinks++;
    prevLen = o.plainLen;
  }
  if (!o.running && mdSwitchAt < 0) mdSwitchAt = i;
  if (i % 4 === 0) console.log(`t=${((i + 1) * 0.4).toFixed(1)}s`, JSON.stringify(o));
  if (!o.running && i > 8) break;
}
console.log("RESULT: samples with text:", samplesWithText, "| grows:", grows, "| shrinks:", shrinks, "| turn finished at sample:", mdSwitchAt);
socket.close();
