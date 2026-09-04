const fs = require("fs");
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
    return m.result.result.value;
  };
  const jsqr = await fs.promises.readFile("node_modules/jsqr/dist/jsQR.js", "utf8");
  const r = await ev(`(async () => {
    ${jsqr}
    const qr = await window.codex.weixinStartLogin();
    if (!qr || !qr.qrcodeImg) return { error: "no qr" };
    const div = document.createElement("div");
    div.innerHTML = qr.qrcodeImg;
    const svg = div.querySelector("svg");
    if (!svg) return { error: "not svg", head: qr.qrcodeImg.slice(0, 40) };
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("img")); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml); });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth * 3; c.height = img.naturalHeight * 3;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const res = jsQR(d.data, d.width, d.height);
    return res ? { ok: true, value: res.data.slice(0, 70) } : { ok: false };
  })()`);
  console.log("机读终验:", JSON.stringify(r));
  ws.close();
  process.exit(0);
})();
