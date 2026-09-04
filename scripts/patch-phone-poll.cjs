// 手机对话页 JS 通道替换（写文件执行，避免 -e 转义坑）
const fs = require("fs");
let s = fs.readFileSync("electron/remote.ts", "utf8");

const oldRpc = `function rpc(payload) {
  return new Promise((resolve, reject) => {
    const reqId = String(++rpcSeq);
    rpcWaiters.set(reqId, { resolve, reject });
    ws.send(JSON.stringify({ ...payload, reqId }));
    setTimeout(() => { if (rpcWaiters.has(reqId)) { rpcWaiters.delete(reqId); reject(new Error("timeout")); } }, 15000);
  });
}`;
const newRpc = `async function rpc(payload) {
  const reqId = String(++rpcSeq);
  const res = await fetch("/api/rpc", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ ...payload, reqId }) });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}`;
if (!s.includes(oldRpc)) { console.log("RPC BLOCK NOT FOUND"); process.exit(1); }
s = s.replace(oldRpc, newRpc);
fs.writeFileSync("electron/remote.ts", s);
console.log("rpc -> http ok");
