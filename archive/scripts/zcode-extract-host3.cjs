// 通过 header 树逐级定位并提取 host/index.js（2.3MB 主 bundle）
const asar = require("@electron/asar");
const fs = require("fs");
const src = "D:\\Users\\Administrator\\AppData\\Local\\Programs\\ZCode\\resources\\app.asar";
const buf = asar.extractFile(src, "out\\host\\index.js");
const t = buf.toString("utf8");
fs.writeFileSync("tmp-zcode-asar/host-index.js", t);
console.log("extracted:", t.length, "chars | feishu:", (t.match(/[Ff]eishu/g) || []).length, "| lark:", (t.match(/[Ll]ark/g) || []).length);
