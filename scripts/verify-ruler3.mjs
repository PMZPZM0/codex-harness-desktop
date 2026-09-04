// 打开长会话并验证刻度尺 + 滚轮独立
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
  if (m.result.exceptionDetails) return { __exc: JSON.stringify(m.result.exceptionDetails).slice(0, 200) };
  return m.result.result.value;
};

const clicked = await ev(`(() => {
  const items = [...document.querySelectorAll(".sidebar button, .sidebar li, .sidebar [class*=thread]")].filter((b) => b.innerText && b.innerText.includes("测试"));
  if (items.length) { items[0].click(); return String(items[0].className).slice(0, 60); }
  return "not found";
})()`);
console.log("clicked:", clicked);
await new Promise((r) => setTimeout(r, 1500));

const st = await ev(`(() => {
  const tl = document.querySelector(".timeline");
  return { scrollable: tl.scrollHeight - tl.clientHeight > 80, ticks: document.querySelectorAll(".ruler-tick").length };
})()`);
console.log("state:", JSON.stringify(st));

if (st.ticks > 0) {
  const scrollBefore = await ev(`document.querySelector(".timeline").scrollTop`);
  const firstBefore = await ev(`document.querySelector(".ruler-tick")?.getAttribute("aria-label")?.slice(0, 16)`);
  await ev(`document.querySelector(".ruler-track").dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }))`);
  await new Promise((r) => setTimeout(r, 300));
  const scrollAfter = await ev(`document.querySelector(".timeline").scrollTop`);
  const firstAfter = await ev(`document.querySelector(".ruler-tick")?.getAttribute("aria-label")?.slice(0, 16)`);
  console.log("timeline scrollTop:", scrollBefore, "->", scrollAfter, scrollBefore === scrollAfter ? "独立 YES" : "对话也被滚 NO");
  console.log("first tick:", JSON.stringify(firstBefore), "->", JSON.stringify(firstAfter), firstBefore !== firstAfter ? "窗口滑动 YES" : "窗口未变（消息数<=50 时窗口本来就不动）");
}
socket.close();
process.exit(0);
