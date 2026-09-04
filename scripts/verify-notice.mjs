// 探测会话列表 selector 并触发通知验证
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

// 直接发一条消息（新会话），流式结束必然有 agent 消息 + 用户消息
await evaluate(`(() => {
  const textarea = document.querySelector(".composer textarea");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(textarea, "回复一个字：好");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector(".composer").requestSubmit();
})()`);
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const running = await evaluate(`Boolean(document.querySelector(".stop-button"))`);
  const hasAgent = await evaluate(`Boolean(document.querySelector(".assistant-message"))`);
  if (!running && hasAgent) break;
}
console.log("agent ready:", await evaluate(`Boolean(document.querySelector(".assistant-message"))`));

// 成功态：点复制按钮
await evaluate(`document.querySelector(".assistant-message .message-action-default")?.click()`);
await new Promise((r) => setTimeout(r, 500));
const s1 = await evaluate(`(() => {
  const n = document.querySelector(".notice");
  if (!n) return { exists: false };
  const rect = n.getBoundingClientRect();
  return { exists: true, cls: n.className, top: Math.round(rect.top), centerX: Math.round(rect.left + rect.width / 2), winW: window.innerWidth, text: n.innerText.slice(0, 30) };
})()`);
console.log("SUCCESS:", JSON.stringify(s1));
if (s1.exists) console.log("centered:", Math.abs(s1.centerX - s1.winW / 2) < 25 ? "YES" : "NO", "| tone=success:", s1.cls.includes("success"));

await new Promise((r) => setTimeout(r, 2800));
console.log("auto-dismissed:", await evaluate(`!document.querySelector(".notice")`) ? "YES" : "NO");

// 错误态：剪贴板无图粘贴
await evaluate(`document.querySelector('.composer .icon-button[title="粘贴剪贴板图片"]')?.click()`);
await new Promise((r) => setTimeout(r, 800));
const s2 = await evaluate(`(() => {
  const n = document.querySelector(".notice");
  if (!n) return { exists: false };
  return { exists: true, cls: n.className, text: n.innerText.slice(0, 30) };
})()`);
console.log("ERROR:", JSON.stringify(s2), "| tone=error:", String(s2.cls).includes("error"));
socket.close();
