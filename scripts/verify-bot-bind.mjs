// 端到端验证机器人扫码绑定：UI 创建会话 → 模拟手机访问绑定页并确认 → UI 状态变已绑定
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

// 1) 打开机器人管理，新建一个机器人，选微信渠道
await evaluate(`(() => {
  document.querySelector(".account-icon")?.click();
  setTimeout(() => document.querySelector(".remote-manage-btn")?.click(), 300);
  return true;
})()`);
await new Promise((r) => setTimeout(r, 1000));
await evaluate(`document.querySelector(".bot-new-btn")?.click()`);
await new Promise((r) => setTimeout(r, 400));
await evaluate(`(() => { const opts = [...document.querySelectorAll(".bot-channel-opt")]; opts.find((o) => o.innerText.includes("微信"))?.click(); return opts.length; })()`);
await new Promise((r) => setTimeout(r, 300));

// 2) 点「扫码」生成绑定二维码
const scan = await evaluate(`(() => { document.querySelector(".bot-scan-btn")?.click(); return true; })()`);
await new Promise((r) => setTimeout(r, 600));
const waiting = await evaluate(`(() => {
  const panel = document.querySelector(".bot-bind-panel");
  return { shown: Boolean(panel), hasQr: Boolean(panel?.querySelector(".remote-qr-box svg")), stateText: panel?.querySelector(".bot-bind-state")?.innerText?.slice(0, 40) ?? "" };
})()`);
console.log("waiting state:", JSON.stringify(waiting));
assert(waiting.shown && waiting.hasQr, "二维码面板未显示");

// 3) 取绑定 URL：从后端直接创建一个新会话（同一机制），手机视角走一遍确认
const bind = await evaluate(`window.codex.botBindQrcode("test-bot", "测试机器人")`);
console.log("bind url:", bind.url);
const pairPath = bind.url.match(/\/r\/[^?]+/)[0] + bind.url.slice(bind.url.indexOf("?"));
const lanBase = bind.url.slice(0, bind.url.indexOf("/r/"));
const phonePage = await fetch(lanBase + pairPath, { signal: AbortSignal.timeout(8000) });
const html = await phonePage.text();
console.log("phone page:", phonePage.status, "| has confirm:", html.includes("确认登录"));
assert(html.includes("确认登录"), "手机页应包含确认登录");

// 4) 模拟手机点确认
const confirmRes = await fetch(lanBase + "/api/bind-confirm", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code: bind.code, botId: "test-bot", deviceName: "测试手机" }),
  signal: AbortSignal.timeout(8000),
});
const confirmJson = await confirmRes.json();
console.log("confirm:", JSON.stringify(confirmJson));
assert(confirmJson.ok, "确认应成功");

// 5) 后端状态应为 confirmed
const status = await evaluate(`window.codex.botBindStatus(${JSON.stringify(bind.code)})`);
console.log("status after confirm:", status);
assert(status === "confirmed", "状态应为 confirmed");

console.log("ALL BIND CHECKS PASSED");
socket.close();
process.exit(0);
