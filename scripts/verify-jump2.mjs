// 修正版：切回“测试”之前装监听（监听器绑在 timeline 元素上会因 React 重挂/元素替换丢失——
// 改为 document 级捕获 + 每次采样直接读 scrollTop）
const t = await fetch("http://127.0.0.1:9223/json").then((r) => r.json());
const p = t.find((x) => x.title === "Codex Harness Desktop");
if (!p) { console.log("app down"); process.exit(1); }
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
// 先在别的会话
await ev(`(() => { const rows = [...document.querySelectorAll(".thread-row")]; const o = rows.find((r) => !r.innerText.includes("测试")); if (o) o.querySelector("button").click(); return true; })()`);
await new Promise((r) => setTimeout(r, 1200));
// 切回测试会话，立即高频采样 scrollTop
await ev(`(() => { const rows = [...document.querySelectorAll(".thread-row")]; const tt = rows.find((r) => r.innerText.includes("测试")); if (tt) tt.querySelector("button").click(); return true; })()`);
const samples = [];
for (let i = 0; i < 12; i++) {
  const sc = await ev(`(() => { const tl = document.querySelector(".timeline"); return { ms: ${i * 120}, top: Math.round(tl.scrollTop), h: tl.scrollHeight, atBottom: tl.scrollTop + tl.clientHeight >= tl.scrollHeight - 40 }; })()`);
  samples.push(sc);
  if (sc.atBottom) break;
  await new Promise((r) => setTimeout(r, 120));
}
console.log("timeline:", JSON.stringify(samples));
console.log("结论:", samples[0].atBottom ? "首帧即在底部 ✓" : samples.some((s) => s.atBottom) ? `第 ${samples.find((s) => s.atBottom).ms}ms 到底（无动画期）` : "始终未到底 ✗");
ws.close();
process.exit(0);
