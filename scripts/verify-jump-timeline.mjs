// 带时间线验证：切会话后 0ms / 300ms / 700ms / 1200ms 时的 scrollTop
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
// 先切到别的会话，再切回“测试”，抓时间线
await ev(`(() => { const rows = [...document.querySelectorAll(".thread-row")]; const other = rows.find((row) => !row.innerText.includes("测试")); if (other) other.querySelector("button")?.click(); return true; })()`);
await new Promise((r) => setTimeout(r, 1200));
await ev(`(() => { const rows = [...document.querySelectorAll(".thread-row")]; const target = rows.find((row) => row.innerText.includes("测试")); if (target) target.querySelector("button")?.click(); return true; })()`);
for (const ms of [50, 300, 700, 1200, 2000]) {
  await new Promise((r) => setTimeout(r, ms === 50 ? 50 : ms - (ms === 300 ? 50 : ms === 700 ? 300 : ms === 1200 ? 700 : 1200)));
  const sc = await ev(`(() => { const tl = document.querySelector(".timeline"); return { t: "${ms}ms", top: Math.round(tl.scrollTop), h: tl.scrollHeight, atBottom: tl.scrollTop + tl.clientHeight >= tl.scrollHeight - 40 }; })()`);
  console.log(JSON.stringify(sc));
}
ws.close();
process.exit(0);
