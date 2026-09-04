// 动态刻度尺窗口验证：点进长会话，检查刻度数与轨道容量一致，滚轮滑动窗口
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
  if (m.result.exceptionDetails) return { __exc: 1 };
  return m.result.result.value;
};

// 打开长会话（消息最多的）
await ev(`(() => { const items = [...document.querySelectorAll(".thread-row button")].filter((b) => b.innerText.includes("测试")); if (items.length) items[0].click(); return items.length; })()`);
await new Promise((r) => setTimeout(r, 1600));

const st = await ev(`(() => {
  const track = document.querySelector(".ruler-track");
  const ticks = [...document.querySelectorAll(".ruler-tick")];
  if (!track || !ticks.length) return { empty: true };
  const last = ticks[ticks.length - 1];
  return {
    trackH: Math.round(track.clientHeight),
    tickCount: ticks.length,
    lastBottom: Math.round(last.getBoundingClientRect().bottom),
    trackBottom: Math.round(track.getBoundingClientRect().bottom),
    firstLabel: ticks[0].getAttribute("aria-label")?.slice(0, 14),
  };
})()`);
console.log("ruler:", JSON.stringify(st));

if (!st.empty) {
  // 滚轮向上滑窗口
  const before = st.firstLabel;
  for (let i = 0; i < 3; i++) {
    await ev(`document.querySelector(".ruler-track").dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }))`);
    await new Promise((r) => setTimeout(r, 120));
  }
  const after = await ev(`document.querySelector(".ruler-tick")?.getAttribute("aria-label")?.slice(0, 14)`);
  console.log("wheel window slide:", JSON.stringify(before), "->", JSON.stringify(after), before !== after ? "YES" : "(窗口到底/未动)");
}
ws.close();
process.exit(0);
