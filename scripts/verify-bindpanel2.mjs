import assert from "node:assert/strict";
const targets = await fetch("http://127.0.0.1:9223/json").then((r) => r.json());
const page = targets.find((t) => t.type === "page" && t.title === "Codex Harness Desktop");
const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 0;
socket.onmessage = ({ data }) => { const m = JSON.parse(data); const r = pending.get(m.id); if (r) { pending.delete(m.id); r(m); } };
await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
const send = (method, params = {}) => new Promise((res) => { const id = ++nextId; pending.set(id, res); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const m = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (m.result.exceptionDetails) return { __exception: 1 };
  return m.result.result.value;
};
const layout = await evaluate(`(() => {
  const qrBox = document.querySelector(".bot-bind-panel .remote-qr-box");
  const state = document.querySelector(".bot-bind-state");
  if (!qrBox || !state) return { missing: true, panel: Boolean(document.querySelector(".bot-bind-panel")) };
  const a = qrBox.getBoundingClientRect(), b = state.getBoundingClientRect();
  return {
    qrRight: Math.round(a.right), stateLeft: Math.round(b.left),
    overlap: a.right > b.left + 2,
    qrSize: Math.round(a.width) + "x" + Math.round(a.height),
    stateLines: state.innerText.split("\\n").filter(Boolean).length,
    text: state.innerText.slice(0, 90),
  };
})()`);
console.log(JSON.stringify(layout, null, 1));
if (!layout.missing) console.log("NO OVERLAP:", layout.overlap === false ? "YES" : "STILL OVERLAPPING");
const shot = await send("Page.captureScreenshot", { format: "png" });
const fs = await import("node:fs/promises");
await fs.writeFile("s-bind-panel.png", Buffer.from(shot.result.data, "base64"));
console.log("screenshot: s-bind-panel.png");
socket.close();
process.exit(0);
