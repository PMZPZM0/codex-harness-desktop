// 接通断链：remote.start() 后订阅 onThreadEvent → broadcastThreadEvent
const fs = require("fs");
let s = fs.readFileSync("electron/remote.ts", "utf8");

// 在 start() 的 startTunnel() 后订阅
const anchor = `    this.ensureFirewall();
    this.startTunnel();
    return this.port;`;
if (!s.includes(anchor)) { console.log("START ANCHOR NOT FOUND"); process.exit(1); }
const next = `    this.ensureFirewall();
    this.startTunnel();
    // 订阅引擎流式事件 → 推给手机对话页（含轮询缓冲）
    this.events.onThreadEvent?.((event) => this.broadcastThreadEvent(event));
    return this.port;`;
s = s.replace(anchor, next);
fs.writeFileSync("electron/remote.ts", s);
console.log("onThreadEvent subscribed:", s.includes("this.events.onThreadEvent?.((event)"));
