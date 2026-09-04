// 验证：1) 对话框滚动条恢复可见 2) 刻度尺滚轮独立（滚轮事件后 timeline scrollTop 不变，刻度窗口滑动）
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

// 1) 滚动条恢复
const bar = await evaluate(`(() => {
  const tl = document.querySelector(".timeline");
  const css = getComputedStyle(tl);
  return { scrollbarWidth: css.scrollbarWidth, offsetH: tl.offsetHeight - tl.clientHeight };
})()`);
console.log("timeline scrollbar:", JSON.stringify(bar), bar.scrollbarWidth !== "none" ? "(可见)" : "(仍隐藏!)");

// 2) 刻度尺存在且滚轮独立：dispatch wheel 到 ruler-track，timeline.scrollTop 应不变
const needsMany = await evaluate(`(() => {
  const track = document.querySelector(".ruler-track");
  const tl = document.querySelector(".timeline");
  return { hasTrack: Boolean(track), scrollable: tl.scrollHeight - tl.clientHeight > 80, ticks: document.querySelectorAll(".ruler-tick").length };
})()`);
console.log("ruler state:", JSON.stringify(needsMany));

if (needsMany.hasTrack) {
  const scrollBefore = await evaluate(`document.querySelector(".timeline").scrollTop`);
  const firstBefore = await evaluate(`document.querySelector(".ruler-tick")?.getAttribute("aria-label")?.slice(0, 20)`);
  // 原生 wheel 事件（bubbles 到 track 上的监听）
  await evaluate(`(() => {
    const track = document.querySelector(".ruler-track");
    track.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }));
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  const scrollAfter = await evaluate(`document.querySelector(".timeline").scrollTop`);
  const firstAfter = await evaluate(`document.querySelector(".ruler-tick")?.getAttribute("aria-label")?.slice(0, 20)`);
  console.log("timeline scrollTop:", scrollBefore, "->", scrollAfter, scrollBefore === scrollAfter ? "(独立 YES)" : "(对话也被滚了 NO)");
  if (needsMany.ticks > 50) console.log("tick window:", firstBefore, "->", firstAfter, firstBefore !== firstAfter ? "(窗口滑动 YES)" : "(窗口未变)");
}
socket.close();
process.exit(0);
