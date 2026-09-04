// 绑定面板布局验证：二维码与文字不重叠 + 截图
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
  if (m.result.exceptionDetails) return { __exception: JSON.stringify(m.result.exceptionDetails).slice(0, 250) };
  return m.result.result.value;
};

// 打开机器人管理（复用已有机器人）
await evaluate(`document.querySelector(".account-icon")?.click()`);
await new Promise((r) => setTimeout(r, 600));
await evaluate(`document.querySelector(".remote-manage-btn")?.click()`);
await new Promise((r) => setTimeout(r, 800));
await evaluate(`(() => { const opts = [...document.querySelectorAll(".bot-channel-opt")]; opts.find((o) => o.innerText.includes("微信"))?.click(); return true; })()`);
await new Promise((r) => setTimeout(r, 300));
await evaluate(`document.querySelector(".bot-scan-btn")?.click()`);
await new Promise((r) => setTimeout(r, 800));

const layout = await evaluate(`(() => {
  const qrBox = document.querySelector(".bot-bind-panel .remote-qr-box");
  const state = document.querySelector(".bot-bind-state");
  if (!qrBox || !state) return { missing: true };
  const a = qrBox.getBoundingClientRect(), b = state.getBoundingClientRect();
  return {
    qrRight: Math.round(a.right), stateLeft: Math.round(b.left),
    overlap: a.right > b.left + 2,
    qrSize: Math.round(a.width) + "x" + Math.round(a.height),
    stateLines: state.innerText.split("\\n").filter(Boolean).length,
    text: state.innerText.slice(0, 80),
  };
})()`);
console.log(JSON.stringify(layout, null, 1));
console.log("NO OVERLAP:", layout.overlap === false ? "YES" : "STILL OVERLAPPING");

// 截图保存
const cdp = await send("Page.captureScreenshot", { format: "png" });
const fs = await import("node:fs/promises");
await fs.writeFile("s-bind-panel.png", Buffer.from(cdp.result.data, "base64"));
console.log("screenshot: s-bind-panel.png");
socket.close();
process.exit(0);
