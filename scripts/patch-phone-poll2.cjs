// 手机对话页：ws 通道整体换成 HTTP 轮询
const fs = require("fs");
let s = fs.readFileSync("electron/remote.ts", "utf8");

const oldOpen = `ws.onopen = () => { document.getElementById("status").textContent = "● 在线"; if (currentThreadId) loadMessages(); else newThread(); };
ws.onclose = () => { document.getElementById("status").textContent = "已断开"; };
ws.onmessage = (e) => {
  let data; try { data = JSON.parse(e.data); } catch { return; }
  if (data.type === "rpc") {
    const waiter = rpcWaiters.get(data.reqId);
    if (waiter) { rpcWaiters.delete(data.reqId); data.error ? waiter.reject(new Error(data.error)) : waiter.resolve(data); }
    return;
  }
  if (data.type === "thread-event" && data.threadId === currentThreadId) {
    if (data.kind === "delta") {
      let el = list.querySelector(".streaming");
      if (!el) el = push("assistant", "", "assistant streaming");
      el.textContent += data.text;
      list.scrollTop = list.scrollHeight;
    } else if (data.kind === "done") {
      const el = list.querySelector(".streaming");
      if (el) el.classList.remove("streaming");
    } else if (data.kind === "user") {
      push("user", data.text);
    }
  }
};`;
const newOpen = `let pollSince = Date.now() - 60000;
async function pollLoop() {
  try {
    const res = await fetch("/api/events?since=" + pollSince);
    const data = await res.json();
    pollSince = data.now || Date.now();
    for (const event of data.events || []) {
      if (event.threadId !== currentThreadId) continue;
      if (event.kind === "delta") {
        let el = list.querySelector(".streaming");
        if (!el) el = push("assistant", "", "assistant streaming");
        el.textContent += event.text;
        list.scrollTop = list.scrollHeight;
      } else if (event.kind === "done") {
        const el = list.querySelector(".streaming");
        if (el) el.classList.remove("streaming");
      } else if (event.kind === "user") push("user", event.text);
    }
    document.getElementById("status").textContent = "● 在线";
  } catch { document.getElementById("status").textContent = "重连中…"; }
  setTimeout(pollLoop, 1500);
}
pollLoop();
(async () => { if (currentThreadId) loadMessages(); else await newThread(); })();`;
if (!s.includes(oldOpen)) { console.log("OPEN BLOCK NOT FOUND"); process.exit(1); }
s = s.replace(oldOpen, newOpen);
fs.writeFileSync("electron/remote.ts", s);
console.log("poll loop installed");
