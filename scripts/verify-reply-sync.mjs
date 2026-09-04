// 关键验证：send-message 后 /api/events 是否真的推 delta（用户报“发消息没回复”）
(async () => {
  const t = await fetch("http://127.0.0.1:9223/json").then((r) => r.json());
  const p = t.find((x) => x.title === "Codex Harness Desktop");
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

  const bind = await evaluate(`window.codex.botBindQrcode("reply-test", "回复测试")`);
  const url = bind.value.url;
  const base = url.slice(0, url.indexOf("/r/"));
  const rpc = async (payload) => (await fetch(base + "/api/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(25000) })).json();

  const created = await rpc({ type: "new-thread" });
  const threadId = created.threadId;
  console.log("thread:", threadId?.slice(0, 14));
  await rpc({ type: "send-message", threadId, text: "Reply with exactly OK." });

  // 模拟手机轮询：每 1.5s 拉 events，看有没有该 threadId 的 delta
  let since = Date.now() - 3000;
  let got = null;
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const events = await fetch(base + "/api/events?since=" + since, { signal: AbortSignal.timeout(20000) }).then((r) => r.json());
    since = events.now;
    const mine = (events.events ?? []).filter((e2) => e2.threadId === threadId);
    if (mine.length) { got = mine; console.log(`poll#${i + 1}: got ${mine.length} events, kinds:`, [...new Set(mine.map((e2) => e2.kind))].join(","), "| first delta:", JSON.stringify((mine.find((e2) => e2.kind === "delta") ?? {}).text?.slice(0, 30))); break; }
    if (i === 24) console.log("NO events for this thread in 37s — 回复同步断了");
  }
  if (got) {
    // 继续拉到 done
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const events = await fetch(base + "/api/events?since=" + since, { signal: AbortSignal.timeout(20000) }).then((r) => r.json());
      since = events.now;
      const done = (events.events ?? []).some((e2) => e2.threadId === threadId && e2.kind === "done");
      if (done) { console.log("done event received ✓"); break; }
    }
  }
  ws.close();
  process.exit(0);
})();
