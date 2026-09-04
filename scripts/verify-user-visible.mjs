// 用户消息可见性全程实测：发送 → 流式 → 完成，每秒采样用户气泡存在性
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
  return m.result.result.value;
};

const MSG = "帮我把这句话重复一遍：消息可见性测试。";
await evaluate(`(() => {
  document.querySelector(".new-thread")?.click();
  const textarea = document.querySelector(".composer textarea");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(textarea, ${JSON.stringify(MSG)});
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector(".composer").requestSubmit();
})()`);

let userMissingTicks = 0, totalTicks = 0, finalHasUser = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await evaluate(`(() => {
    const users = [...document.querySelectorAll(".user-message")];
    return {
      userCount: users.length,
      hasMine: users.some((el) => el.innerText.includes("消息可见性测试")),
      running: Boolean(document.querySelector(".stop-button")),
      optimistic: Boolean(document.querySelector(".timeline-bottom-spacer")),
    };
  })()`);
  totalTicks++;
  if (!s.hasMine) userMissingTicks++;
  else finalHasUser = true;
  if (i % 4 === 0) console.log(`t=${i + 1}s hasMine=${s.hasMine} running=${s.running}`);
  if (!s.running && s.hasMine) { finalHasUser = true; break; }
}
console.log("RESULT: user message present at end:", finalHasUser, `| missing ticks: ${userMissingTicks}/${totalTicks}`);
socket.close();
