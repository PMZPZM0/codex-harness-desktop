const fs = require("fs");
const p = "C:/Users/Administrator/AppData/Roaming/Codex Harness Desktop/weixin-accounts/weixin-account.json";
const d = JSON.parse(fs.readFileSync(p, "utf8"));
console.log("before:", d.baseUrl);
d.baseUrl = String(d.baseUrl).replace(/^(https?:\/\/)+/, "https://");
fs.writeFileSync(p, JSON.stringify(d, null, 2));
console.log("after:", JSON.parse(fs.readFileSync(p, "utf8")).baseUrl);
process.exit(0);
