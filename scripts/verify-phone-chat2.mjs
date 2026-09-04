// 手机对话页端到端：全部走 HTTP（确认绑定 → 对话页 → /api/rpc 列表/消息/发消息 → /api/events 轮询）
(async () => {
  const t = await fetch("http://127.0.0.1:9223/json").then((r) => r.json());
  const p = t.find((x) => x.title === "Codex Harness Desktop");
  if (!p) { console.log("app not up"); process.exit(1); }
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  let n = 0;
  const pend = new Map();
  ws.onmessage = ({ data }) => { const m = JSON.parse(data); const r = pend.get(m.id); if (r) { pend.delete(m.id); r(m); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise((res) => { const id = ++n; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const m = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    return { value: m.result.result?.value, exc: m.result.exceptionDetails ? "EXC" : null };
  };

  const bind = await evaluate(`window.codex.botBindQrcode("e2e-http", "HTTP对话")`);
  const url = bind.value.url;
  const base = url.slice(0, url.indexOf("/r/"));
  console.log("tunnel:", base.slice(8, 50));

  const confirmRes = await fetch(base + "/api/bind-confirm", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: bind.value.code, botId: "e2e-http", deviceName: "测试手机" }),
    signal: AbortSignal.timeout(20000),
  });
  console.log("confirm:", JSON.stringify(await confirmRes.json()));

  const rpc = async (payload) => {
    const res = await fetch(base + "/api/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(25000) });
    return res.json();
  };

  const threads = await rpc({ type: "list-threads" });
  console.log("list-threads:", (threads.threads ?? []).length, "个会话");
  const first = (threads.threads ?? [])[0];
  if (first) {
    const msgs = await rpc({ type: "get-messages", threadId: first.id });
    console.log("first thread messages:", (msgs.messages ?? []).length, "条");
  }
  const created = await rpc({ type: "new-thread" });
  console.log("new-thread:", created.threadId ? "OK " + created.threadId.slice(0, 12) : JSON.stringify(created));
  if (created.threadId) {
    const sent = await rpc({ type: "send-message", threadId: created.threadId, text: "Reply with exactly OK." });
    console.log("send-message:", JSON.stringify(sent));
    // 轮询 20 秒看增量
    let since = Date.now() - 5000;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const events = await fetch(base + "/api/events?since=" + since, { signal: AbortSignal.timeout(20000) }).then((r) => r.json());
      since = events.now;
      const deltas = (events.events ?? []).filter((e2) => e2.kind === "delta");
      if (deltas.length) { console.log("stream deltas received:", deltas.length, "| sample:", JSON.stringify(deltas[0].text.slice(0, 30))); break; }
    }
  }
  ws.close();
  console.log("ALL HTTP CHAT CHECKS DONE");
  process.exit(0);
})().catch((e) => { console.log("ERR", e.message); process.exit(1); });
