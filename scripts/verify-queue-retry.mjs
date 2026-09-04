// 验证重试逻辑（与应用 startQueued 相同策略）：interrupt → queue/start 重试直到接受
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
await ev(`(() => { const ta = document.querySelector(".composer textarea"); const st = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; st.call(ta, "排队消息C：简短回复"); ta.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector(".composer").requestSubmit(); })()`);
await new Promise((r) => setTimeout(r, 1000));

const result = await ev(`(async () => {
  const threadId = (await window.codex.request("thread/list", { limit: 1 })).data[0].id;
  const active = await window.codex.request("thread/get", { threadId }).then(r => r.thread?.turns?.some(t2 => t2.status === "inProgress")).catch(() => false);
  if (active) {
    const runningTurn = (await window.codex.request("thread/get", { threadId })).thread.turns.find(t2 => t2.status === "inProgress");
    await window.codex.request("turn/interrupt", { threadId, turnId: runningTurn.id }).catch(() => undefined);
  }
  // 重试 queue/start（与应用内 startQueued 一致）
  let started = false, attempts = 0;
  for (let i = 0; i < 30 && !started; i++) {
    attempts = i + 1;
    started = await window.codex.request("thread/queue/list", { threadId, limit: 1 }).then(async q => {
      if (!q.data?.[0]) return true; // 已被自动消费
      return window.codex.request("thread/queue/start", { threadId, queuedSubmissionId: q.data[0].id }).then(() => true).catch(e => {
        if (!/active or pending turn/i.test(e.message)) throw e;
        return new Promise(resolve => setTimeout(() => resolve(false), 500));
      });
    });
  }
  return { started, attempts };
})()`);
console.log("retry result:", JSON.stringify(result));
// 等回复
await new Promise((r) => setTimeout(r, 15000));
const agent = await ev(`(() => { const a = [...document.querySelectorAll(".assistant-message")].pop(); return a ? a.innerText.slice(-70).replace(/\\n/g, "|") : ""; })()`);
console.log("last agent:", JSON.stringify(agent));
ws.close();
process.exit(0);
