// 验证 UI 修复后的「立即」：模拟 UI 的 startQueued（interrupt→等待→queue/start）
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
  return m.result.result?.value;
};

await ev(`document.querySelector(".new-thread")?.click()`);
await new Promise((r) => setTimeout(r, 500));
await ev(`(() => { const ta = document.querySelector(".composer textarea"); const st = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; st.call(ta, "数到30，每个数字一行。"); ta.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector(".composer").requestSubmit(); })()`);
await new Promise((r) => setTimeout(r, 2000));
// UI 路径排队（跟真实点击一样走 UI 的排队？排队是自动的——手动发第二条被 queue 捕获）
await ev(`(() => { const ta = document.querySelector(".composer textarea"); const st = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; st.call(ta, "排队消息B：数到3"); ta.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector(".composer").requestSubmit(); })()`);
await new Promise((r) => setTimeout(r, 1200));
const q = await ev(`window.codex.request("thread/list", { limit: 1 }).then(r => window.codex.request("thread/queue/list", { threadId: r.data[0].id, limit: 10 }).then(q2 => JSON.stringify((q2.data ?? []).map(x => x.id.slice(0, 10))))).catch(e => "ERR:" + e.message)`);
console.log("queue:", q);
// 调用 UI 的 startQueued（通过 React 无法直接调；模拟其逻辑：interrupt→等→queue/start）
const runStart = Date.now();
const res = await ev(`(async () => {
  const threadId = (await window.codex.request("thread/list", { limit: 1 })).data[0].id;
  const active = await window.codex.request("thread/get", { threadId }).then(r => r.thread?.turns?.some(t2 => t2.status === "inProgress")).catch(() => false);
  if (active) {
    const runningTurn = (await window.codex.request("thread/get", { threadId })).thread.turns.find(t2 => t2.status === "inProgress");
    await window.codex.request("turn/interrupt", { threadId, turnId: runningTurn.id }).catch(() => undefined);
    for (let i = 0; i < 20; i++) {
      await new Promise(r2 => setTimeout(r2, 500));
      const still = await window.codex.request("thread/get", { threadId }).then(r2 => r2.thread?.turns?.some(t3 => t3.status === "inProgress")).catch(() => true);
      if (!still) break;
    }
  }
  const q = await window.codex.request("thread/queue/list", { threadId, limit: 1 });
  if (!q.data?.[0]) return { result: "queue empty (可能已被自动消费)" };
  const started = await window.codex.request("thread/queue/start", { threadId, queuedSubmissionId: q.data[0].id }).then(() => "OK").catch(e => "ERR:" + e.message);
  return { result: started };
})()`);
console.log("immediate after interrupt:", JSON.stringify(res), `(${Date.now() - runStart}ms)`);
// 看回复
await new Promise((r) => setTimeout(r, 12000));
const agent = await ev(`(() => { const a = [...document.querySelectorAll(".assistant-message")].pop(); return a ? a.innerText.slice(-80).replace(/\\n/g, "|") : ""; })()`);
console.log("last agent:", JSON.stringify(agent));
ws.close();
process.exit(0);
