// 最终验证：新会话里引擎工具列表是否真的暴露 desktop_*；回复速度对比
import assert from "node:assert/strict";

const targets = await fetch("http://127.0.0.1:9223/json").then((r) => r.json());
const page = targets.find((t) => t.type === "page" && t.title === "Codex Harness Desktop");
assert(page, "app not up");
const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 0;
socket.onmessage = ({ data }) => { const m = JSON.parse(data); const r = pending.get(m.id); if (r) { pending.delete(m.id); r(m); } };
await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
const send = (method, params = {}) => new Promise((res) => { const id = ++nextId; pending.set(id, res); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const m = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return m.result.result?.value;
};

// 直接问引擎：thread/start 后看 MCP 状态（mcpServer/startupStatus/updated 事件）
await evaluate(`window.__mcp = []; window.codex.onEvent(function(e){ if (e.method === "mcpServer/startupStatus/updated") window.__mcp.push(JSON.stringify(e.params)); });`);
await evaluate(`(() => {
  document.querySelector(".new-thread")?.click();
  const textarea = document.querySelector(".composer textarea");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(textarea, "Reply with exactly OK.");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector(".composer").requestSubmit();
})()`);

let toolTokenLine = "";
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await evaluate(`({ running: Boolean(document.querySelector(".stop-button")), mcp: window.__mcp.slice(-2), assistant: (document.querySelector(".assistant-message")?.innerText ?? "").slice(0, 60) })`);
  const nuphusReady = JSON.stringify(s.mcp ?? []).includes('"nuphus"');
  if (!s.running && s.assistant) {
    console.log("reply:", s.assistant);
    console.log("nuphus MCP events:", s.mcp);
    toolTokenLine = s.assistant;
    break;
  }
  if (i === 28) { console.log("mcp events:", JSON.stringify(s.mcp)); }
}
socket.close();
process.exit(0);
