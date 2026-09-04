// 微信 iLink 登录流程真机验证：调 weixin:start-login 看能否从腾讯拿到真实二维码
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
    return { value: m.result.result?.value, exc: m.result.exceptionDetails ? JSON.stringify(m.result.exceptionDetails).slice(0, 300) : null };
  };

  const result = await evaluate(`window.codex.weixinStartLogin ? window.codex.weixinStartLogin().then(function(r){ return { hasImg: Boolean(r && r.qrcodeImg), imgHead: r && r.qrcodeImg ? String(r.qrcodeImg).slice(0, 40) : null, hasQrcode: Boolean(r && r.qrcode) }; }).catch(function(e){ return { error: e.message }; }) : { error: "api missing" }`);
  console.log("iLink login:", JSON.stringify(result.value ?? result.exc, null, 1));

  // 轮询一次状态（此时应 wait —— 没人扫）
  const poll = await evaluate(`window.codex.weixinPollLogin ? window.codex.weixinPollLogin().then(function(r){ return r; }).catch(function(e){ return { error: e.message }; }) : { error: "api missing" }`);
  console.log("poll:", JSON.stringify(poll.value ?? poll.exc));
  ws.close();
  process.exit(0);
})();
