// 全量搜（CJS，修正 path import 位置）
const asar = require("@electron/asar");
const fs = require("fs");
const path = require("path");
if (!fs.existsSync("tmp-zcode-asar")) fs.mkdirSync("tmp-zcode-asar");
const src = "D:\\Users\\Administrator\\AppData\\Local\\Programs\\ZCode\\resources\\app.asar";
const list = asar.listPackage(src).map((p) => p.replace(/\\/g, "/")).filter((p) => p.startsWith("/out/") && p.endsWith(".js"));
console.log("scanning", list.length, "files");
let found = 0;
for (const rel of list) {
  try {
    const buf = asar.extractFile(src, rel.slice(1));
    const t = buf.toString("utf8");
    const feishuCount = (t.match(/[Ff]eishu/g) || []).length;
    const larkCount = (t.match(/\b[Ll]ark\b/g) || []).length;
    if (feishuCount + larkCount > 20) {
      found++;
      console.log(`${rel}: feishu=${feishuCount} lark=${larkCount} size=${t.length}`);
      fs.writeFileSync(path.join("tmp-zcode-asar", path.basename(rel).replace(/\.js$/, "-feishu.js")), t);
    }
  } catch { /* skip */ }
}
console.log("files with heavy feishu/lark refs:", found);
