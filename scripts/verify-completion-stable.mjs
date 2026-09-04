// 完成瞬间稳定性实测：采样滚动位置和内容底部位置，对比完成前后 1.5s 内的位移
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

await evaluate(`(() => {
  const textarea = document.querySelector(".composer textarea");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(textarea, "回复两个字：完成");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector(".composer").requestSubmit();
})()`);

// 每 300ms 采样：最后一条 assistant 消息的 viewport 位置 + 滚动偏移
const positions = [];
let completed = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 300));
  const s = await evaluate(`(() => {
    const agents = document.querySelectorAll(".assistant-message");
    const last = agents[agents.length - 1];
    const scroller = document.querySelector(".timeline, .thread-scroll, main");
    return {
      agentBottom: last ? Math.round(last.getBoundingClientRect().bottom) : -1,
      agentCount: agents.length,
      scrollTop: scroller ? Math.round(scroller.scrollTop) : -1,
      running: Boolean(document.querySelector(".stop-button")),
    };
  })()`);
  positions.push(s);
  if (!s.running && s.agentBottom >= 0) { completed = true; break; }
}
// 完成后再采 8 次（2.4s），看位置稳定性和最大跳动
let maxJump = 0, prevBottom = positions.at(-1).agentBottom, prevScroll = positions.at(-1).scrollTop;
for (let i = 0; i < 8; i++) {
  await new Promise((r) => setTimeout(r, 300));
  const s = await evaluate(`(() => {
    const agents = document.querySelectorAll(".assistant-message");
    const last = agents[agents.length - 1];
    const scroller = document.querySelector(".timeline, .thread-scroll, main");
    return { agentBottom: last ? Math.round(last.getBoundingClientRect().bottom) : -1, scrollTop: scroller ? Math.round(scroller.scrollTop) : -1 };
  })()`);
  maxJump = Math.max(maxJump, Math.abs(s.agentBottom - prevBottom), Math.abs(s.scrollTop - prevScroll) * 0.001);
  prevBottom = s.agentBottom; prevScroll = s.scrollTop;
}
console.log("turn completed:", completed);
console.log("post-completion max visual jump (px):", maxJump);
console.log("verdict:", maxJump <= 2 ? "STABLE (无闪跳)" : "STILL JUMPY");
socket.close();
