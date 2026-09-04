// 验证切会话后 scrollTop 是否在底部（最新消息）
const t = await fetch("http://127.0.0.1:9223/json").then((r) => r.json());
const p = t.find((x) => x.title === "Codex Harness Desktop");
const ws = new WebSocket(p.webSocketDebuggerUrl);
let n = 0;
const pend = new Map();
ws.onmessage = ({ data }) => { const m = JSON.parse(data); const r = pend.get(m.id); if (r) { pend.delete(m.id); r(m); } };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (method, params = {}) => new Promise((res) => { const id = ++n; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => {
  const m = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  return m.result.result.value;
};
await ev(`(() => { const rows = [...document.querySelectorAll(".thread-row")]; const target = rows.find((row) => row.innerText.includes("测试")); if (target) target.querySelector("button")?.click(); return true; })()`);
await new Promise((r) => setTimeout(r, 1500));
const sc = await ev(`(() => { const tl = document.querySelector(".timeline"); const agent = [...document.querySelectorAll(".assistant-message")].pop(); return { scrollTop: Math.round(tl.scrollTop), scrollH: tl.scrollHeight, clientH: tl.clientHeight, atBottom: tl.scrollTop + tl.clientHeight >= tl.scrollHeight - 40, lastAgentVisible: agent ? agent.getBoundingClientRect().top < window.innerHeight : false }; })()`);
console.log("切会话后:", JSON.stringify(sc));
ws.close();
process.exit(0);
