// 欢迎页 ZCode 布局验证：composer 居中停靠、chips 在其下方、水印/问候语位置、发送后过渡
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
  if (m.result.exceptionDetails) return { __exc: JSON.stringify(m.result.exceptionDetails).slice(0, 250) };
  return m.result.result.value;
};

const layout = await ev(`(() => {
  const wrap = document.querySelector(".composer-wrap");
  const composer = document.querySelector(".composer");
  const chips = document.querySelector(".composer-wrap .suggest-row");
  const greet = document.querySelector(".welcome-greet");
  const mark = document.querySelector(".welcome-mark");
  const viewH = window.innerHeight, viewW = window.innerWidth;
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), centerX: Math.round(b.left + b.width / 2) }; };
  return {
    viewH, viewW,
    wrap: r(wrap), wrapClass: wrap?.className,
    composer: r(composer),
    chips: r(chips),
    greet: r(greet),
    mark: r(mark),
  };
})()`);
console.log(JSON.stringify(layout, null, 1));
const okCenter = layout.wrap && Math.abs(layout.wrap.centerX - layout.viewW / 2) < 20;
const okAbove = layout.chips && layout.composer && layout.chips.top >= layout.composer.bottom - 4;
console.log("composer centered:", okCenter ? "YES" : "NO", "| chips below composer:", okAbove ? "YES" : "NO");

// 发消息验证过渡
await ev(`(() => {
  const textarea = document.querySelector(".composer textarea");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(textarea, "回复：好");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector(".composer").requestSubmit();
})()`);
await new Promise((r) => setTimeout(r, 600));
const after = await ev(`(() => {
  const wrap = document.querySelector(".composer-wrap");
  return { cls: wrap?.className, docked: wrap?.className.includes("docked-center") };
})()`);
console.log("after send:", JSON.stringify(after), after.docked === false ? "过渡到底部 YES" : "仍居中 NO");
ws.close();
process.exit(0);
