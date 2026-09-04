const fs = require("fs");
let s = fs.readFileSync("electron/main.ts", "utf8");
const anchor = "  void weixinGateway.resume();";
if (!s.includes(anchor)) { console.log("ANCHOR MISSING"); process.exit(1); }
if (!s.includes("telegramGateway.resume")) {
  s = s.replace(anchor, anchor + "\n  void telegramGateway.resume().catch(() => undefined);");
  fs.writeFileSync("electron/main.ts", s);
}
console.log("tg resume:", fs.readFileSync("electron/main.ts", "utf8").includes("telegramGateway.resume"));
process.exit(0);
