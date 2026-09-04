// 手机对话页端到端验证：取对话页 HTML，模拟手机 RPC（list-threads/get-messages/new-thread/send-message）
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

  const bind = await evaluate(`window.codex.botBindQrcode("e2e-chat", "对话测试")`);
  const url = bind.value.url;
  const base = url.slice(0, url.indexOf("/r/"));
  console.log("tunnel:", base.slice(0, 60));

  // 手机视角：确认绑定 → 拿到对话页 URL → 用 Node WebSocket 模拟手机连接
  const confirmRes = await fetch(base + "/api/bind-confirm", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: bind.value.code, botId: "e2e-chat", deviceName: "测试手机" }),
    signal: AbortSignal.timeout(15000),
  });
  console.log("confirm:", JSON.stringify(await confirmRes.json()));

  const chatPath = "/r/" + bind.value.code;
  const page = await fetch(base + chatPath, { signal: AbortSignal.timeout(15000) });
  const html = await page.text();
  console.log("chat page:", page.status, "| has msglist:", html.includes("msglist"), "| has input:", html.includes("send-message"));

  // Node 端模拟手机 WebSocket RPC
  const wsUrl = (base.replace("https://", "wss://").replace("http://", "ws://")) + "/ws/" + bind.value.code;
  const phoneWs = new WebSocket(wsUrl);
  await new Promise((res, rej) => { phoneWs.onopen = res; phoneWs.onerror = () => rej(new Error("ws fail")); });
  console.log("phone ws connected");
  const rpc = (payload) => new Promise((resolve, reject) => {
    const reqId = String(Math.random());
    const onMsg = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "rpc" && data.reqId === reqId) { phoneWs.removeEventListener("message", onMsg); data.error ? reject(new Error(data.error)) : resolve(data); }
    };
    phoneWs.addEventListener("message", onMsg);
    phoneWs.send(JSON.stringify({ ...payload, reqId }));
    setTimeout(() => reject(new Error("rpc timeout")), 20000);
  });
  const threads = await rpc({ type: "list-threads" });
  console.log("list-threads:", (threads.threads ?? []).length, "个会话");
  const first = (threads.threads ?? [])[0];
  if (first) {
    const msgs = await rpc({ type: "get-messages", threadId: first.id });
    console.log("get-messages of first:", (msgs.messages ?? []).length, "条");
  }
  phoneWs.close();
  ws.close();
  process.exit(0);
})().catch((e) => { console.log("ERR", e.message); process.exit(1); });
