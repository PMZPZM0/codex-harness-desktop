import fs from "node:fs";
const code = fs.readFileSync("D:/Codex Harness Desktop/src/App.tsx", "utf8");
console.log("wechat literal:", code.includes("微信"));
console.log("wechat key:", code.includes('"wechat"'));
console.log("channel grid:", code.includes("bot-channel-opt"));
const idx = code.indexOf("bot-channel-opt");
if (idx >= 0) console.log("context:", JSON.stringify(code.slice(idx - 30, idx + 260)));
