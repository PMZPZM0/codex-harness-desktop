// 全量搜：在所有 js 文件内容里搜 feishu/lark 关键词（渠道实现可能是动态注册，文件名不含关键词）
const asar = require("@electron/asar");
const fs = require("fs");
const src = "D:\\Users\\Administrator\\AppData\\Local\\Programs\\ZCode\\resources\\app.asar";
const list = asar.listPackage(src).map((p) => p.replace(/\\/g, "/")).filter((p) => p.startsWith("/out/") && p.endsWith(".js") && !p.includes("chunk"));
console.log("scanning", list.length, "files");
for (const rel of list) {
  try {
    const buf = asar.extractFile(src, rel.slice(1));
    const t = buf.toString("utf8");
    const feishuCount = (t.match(/[Ff]eishu/g) || []).length;
    const larkCount = (t.match(/\b[Ll]ark\b/g) || []).length;
    if (feishuCount + larkCount > 5) {
      console.log(`${rel}: feishu=${feishuCount} lark=${larkCount} size=${t.length}`);
      fs.writeFileSync("tmp-zcode-asar/" + path.basename(rel).replace(/\.js$/, "-feishu.js"), t);
    }
  } catch { /* skip */ }
}
const path = require("path");
