// extractFile 用原始分隔符路径（listPackage 原样），列出并提取 host 主文件
const asar = require("@electron/asar");
const fs = require("fs");
const path = require("path");
const src = "D:\\Users\\Administrator\\AppData\\Local\\Programs\\ZCode\\resources\\app.asar";
const raw = asar.listPackage(src);
const hostFiles = raw.filter((p) => p.includes("out") && p.endsWith("index.js"));
console.log("index.js candidates:");
hostFiles.forEach((p) => console.log(" ", JSON.stringify(p), asar.statFile(src, p).size));
// 提取最大的 host/index.js
let biggest = null, bigSize = 0;
for (const p of hostFiles) {
  const s = asar.statFile(src, p).size;
  if (s > bigSize) { bigSize = s; biggest = p; }
}
if (biggest) {
  const t = asar.extractFile(src, biggest).toString("utf8");
  fs.writeFileSync("tmp-zcode-asar/host-index.js", t);
  console.log("extracted:", biggest, t.length, "chars");
  console.log("feishu refs:", (t.match(/[Ff]eishu/g) || []).length, "| lark refs:", (t.match(/[Ll]ark/g) || []).length);
}
