import fs from "node:fs/promises";

const targets = await fetch(`http://127.0.0.1:${process.env.CODEX_HARNESS_DEBUG_PORT || 9223}/json`).then((r) => r.json());
const page = targets.find((t) => t.type === "page" && t.title === "Codex Harness Desktop");
if (!page) { console.error("no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => {
  const msg = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (msg.result?.exceptionDetails) throw new Error(JSON.stringify(msg.result.exceptionDetails));
  return msg.result?.result?.value;
};
const shot = async (name) => {
  const capture = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(`D:/Codex Harness Desktop/${name}`, Buffer.from(capture.result.data, "base64"));
  console.log("saved", name);
};

await send("Emulation.setDeviceMetricsOverride", { width: 1480, height: 940, deviceScaleFactor: 1, mobile: false });
await new Promise((r) => setTimeout(r, 400));

await evalJs(`(() => { const tabs = document.querySelectorAll(".context-tabs button"); [...tabs].find((b) => b.title === "任务上下文")?.click(); })()`);
await new Promise((r) => setTimeout(r, 300));
await shot("ui-context.png");
await evalJs(`document.querySelector(".new-thread")?.click()`);
await new Promise((r) => setTimeout(r, 400));
await shot("ui-main.png");
await evalJs(`(() => { const chips = document.querySelectorAll(".group-chips button"); chips[1]?.click(); })()`);
await new Promise((r) => setTimeout(r, 300));
await shot("ui-projects.png");
await evalJs(`(() => { const chips = document.querySelectorAll(".group-chips button"); chips[0]?.click(); })()`);
await evalJs(`document.querySelector(".sidebar-settings")?.click()`);
await new Promise((r) => setTimeout(r, 900));
await shot("ui-settings.png");
await evalJs(`document.querySelector(".settings-modal .icon-button")?.click()`);
await new Promise((r) => setTimeout(r, 300));
await evalJs(`(() => { const el = document.querySelector(".composer textarea"); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; set.call(el, "重构首页布局，抽出消息组件并补充单元测试"); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await new Promise((r) => setTimeout(r, 300));
await evalJs(`document.querySelector('.icon-button[title="任务操作"]')?.click()`);
await new Promise((r) => setTimeout(r, 300));
await shot("ui-task-menu.png");
await evalJs(`document.querySelector(".menu-backdrop")?.click()`);
await evalJs(`localStorage.setItem("theme", "dark"); document.documentElement.dataset.theme = "dark";`);
await new Promise((r) => setTimeout(r, 300));
await shot("ui-dark.png");
await evalJs(`localStorage.setItem("theme", "light"); document.documentElement.dataset.theme = "light";`);
ws.close();
process.exit(0);
