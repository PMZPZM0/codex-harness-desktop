// 数数场景实测：验证流式与完成态渲染一致（竖排保持），完成瞬间无跳变
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
  document.querySelector(".new-thread")?.click();
  const textarea = document.querySelector(".composer textarea");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(textarea, "数到20，每个数字一行。");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector(".composer").requestSubmit();
})()`);

// 采样：流式期间与完成后的 <p> 行数和首行文本
let streamingRows = -1, finalRows = -1, streamingFirst = "", finalFirst = "";
for (let i = 0; i < 50; i++) {
  await new Promise((r) => setTimeout(r, 400));
  const s = await evaluate(`(() => {
    const body = document.querySelector(".assistant-message .message-body");
    if (!body) return { rows: 0, first: "", running: true };
    const ps = body.querySelectorAll("p");
    return {
      rows: ps.length,
      first: ps[0]?.textContent ?? "",
      running: Boolean(document.querySelector(".stop-button")),
      textLen: body.textContent.length,
    };
  })()`);
  if (s.running) { streamingRows = s.rows; streamingFirst = s.first; }
  else if (s.textLen > 10) {
    finalRows = s.rows; finalFirst = s.first;
    console.log("final:", JSON.stringify(s));
    break;
  }
  if (i % 5 === 0) console.log(`t=${((i + 1) * 0.4).toFixed(1)}s rows=${s.rows} first=${JSON.stringify(s.first).slice(0, 40)} running=${s.running}`);
}
console.log("STREAM rows:", streamingRows, "first:", JSON.stringify(streamingFirst).slice(0, 40));
console.log("FINAL  rows:", finalRows, "first:", JSON.stringify(finalFirst).slice(0, 40));
console.log("CONSISTENT:", streamingRows === finalRows && streamingFirst === finalFirst ? "YES" : "NO (完成时结构跳变)");
socket.close();
