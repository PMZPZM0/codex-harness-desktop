// statFile 需不带前导反斜杠的路径；重写提取流程
const asar = require("@electron/asar");
const fs = require("fs");
const src = "D:\\Users\\Administrator\\AppData\\Local\\Programs\\ZCode\\resources\\app.asar";
const raw = asar.listPackage(src);
// 过滤 out/host 下的 index.js 与所有 chunk
const hostIdx = raw.find((p) => p.startsWith("\\out\\host\\index.js"));
console.log("hostIdx:", JSON.stringify(hostIdx), hostIdx ? asar.statFile(src, hostIdx).size : "n/a");
if (!hostIdx) process.exit(1);
const t = asar.extractFile(src, hostIdx).toString("utf8");
fs.writeFileSync("tmp-zcode-asar/host-index.js", t);
console.log("extracted:", t.length, "chars | feishu:", (t.match(/[Ff]eishu/g) || []).length, "| lark:", (t.match(/[Ll]ark/g) || []).length);
