import fs from "node:fs";
(async () => {
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
  const st = await ev(`window.codex.channelsStatus ? window.codex.channelsStatus().then(JSON.stringify) : "api missing"`);
  console.log("channels:", st);
  const acct = JSON.parse(fs.readFileSync("C:/Users/Administrator/AppData/Roaming/Codex Harness Desktop/weixin-accounts/weixin-account.json", "utf8"));
  console.log("persisted baseUrl:", acct.baseUrl);
  ws.close();
  process.exit(0);
})();
