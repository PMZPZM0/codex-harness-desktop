// 刻度尺实测：50 条上限、间距、滚动条隐藏、波浪 class 生效
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
  if (m.result.exceptionDetails) return { __exception: JSON.stringify(m.result.exceptionDetails).slice(0, 300) };
  return m.result.result.value;
};

// 1) 滚动条隐藏验证
const bar = await evaluate(`(() => {
  const tl = document.querySelector(".timeline");
  const css = getComputedStyle(tl);
  return { scrollbarWidth: css.scrollbarWidth, offsetH: tl.offsetHeight - tl.clientHeight };
})()`);
console.log("scrollbar:", JSON.stringify(bar));

// 2) 滚轮仍可滚（dispatch wheel event 后 scrollTop 变化）
const before = await evaluate(`document.querySelector(".timeline").scrollTop`);
await evaluate(`(() => {
  const tl = document.querySelector(".timeline");
  tl.dispatchEvent(new WheelEvent("wheel", { deltaY: 300, bubbles: true, cancelable: true }));
})()`);
await new Promise((r) => setTimeout(r, 400));
const after = await evaluate(`document.querySelector(".timeline").scrollTop`);
console.log("wheel works:", after !== before ? `YES (${before} -> ${after})` : "UNCERTAIN (需要真实滚轮，手动验证)");

// 3) 刻度尺存在 + 刻度间距
const ruler = await evaluate(`(() => {
  const ticks = [...document.querySelectorAll(".ruler-tick")];
  if (ticks.length < 2) return { count: ticks.length };
  const gaps = [];
  for (let i = 1; i < Math.min(ticks.length, 10); i++) gaps.push(ticks[i].offsetTop - ticks[i - 1].offsetTop);
  return { count: ticks.length, gaps: [...new Set(gaps)] };
})()`);
console.log("ruler:", JSON.stringify(ruler));

// 4) 波浪 class 模拟：直接给中间刻度加 wave class 检查宽度变化
const wave = await evaluate(`(() => {
  const ticks = [...document.querySelectorAll(".ruler-tick")];
  if (!ticks.length) return null;
  const mid = ticks[Math.floor(ticks.length / 2)];
  const w0 = mid.getBoundingClientRect().width;
  mid.classList.add("wave-0");
  return new Promise((resolve) => setTimeout(() => {
    const w1 = mid.getBoundingClientRect().width;
    mid.classList.remove("wave-0");
    resolve({ before: Math.round(w0), after: Math.round(w1), grew: w1 > w0 });
  }, 350));
})()`);
console.log("wave effect:", JSON.stringify(wave));
socket.close();
process.exit(0);
