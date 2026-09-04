const targets = await fetch("http://127.0.0.1:9223/json").then((r) => r.json());
const page = targets.find((t) => t.type === "page" && t.title === "Codex Harness Desktop");
if (!page) { console.error("no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => {
  const msg = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (msg.result?.exceptionDetails) throw new Error(JSON.stringify(msg.result.exceptionDetails));
  return msg.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const started = await evalJs(`window.codex.remoteStart()`);
const port = started.port;
console.log("port:", port);
const before = await evalJs(`({ events: document.querySelectorAll(".system-event").length })`);
const sock = new WebSocket(`ws://127.0.0.1:${port}/ws/testphone`);
await new Promise((res) => { sock.onopen = res; sock.onerror = () => res(); });
await sleep(1500);
const afterConnect = await evalJs(`({
  events: document.querySelectorAll(".system-event").length,
  lastEvent: [...document.querySelectorAll(".system-event")].at(-1)?.innerText.replace(/\\s+/g, " ").slice(0, 60) ?? "",
  deviceCards: document.querySelectorAll(".remote-device").length,
})`);
sock.send(JSON.stringify({ type: "command", command: "/status" }));
await sleep(2000);
const afterCmd = await evalJs(`({ events: document.querySelectorAll(".system-event").length })`);
sock.close();
console.log(JSON.stringify({ before, afterConnect, afterCmd }, null, 2));
ws.close();
process.exit(0);
