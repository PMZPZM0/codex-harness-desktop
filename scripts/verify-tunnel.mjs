// 验证隧道集成：app 拉起 cloudflared，二维码应指向 https://xxx.trycloudflare.com，且公网可达
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

  const bind = await evaluate(`window.codex.botBindQrcode("tunnel-test", "隧道测试")`);
  const url = bind.value?.url ?? "";
  console.log("bind url:", url);
  if (!url.includes("trycloudflare.com")) console.log("NOT on tunnel domain — tunnel not ready yet or failed");
  else {
    // 公网视角访问（走公网回环到 cloudflare 边缘再回本机）
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const html = await res.text();
      console.log("public fetch:", res.status, "| 确认登录:", html.includes("确认登录") ? "YES" : "NO");
    } catch (e) { console.log("public fetch FAIL:", String(e.message).slice(0, 60)); }
  }
  ws.close();
  process.exit(0);
})();
