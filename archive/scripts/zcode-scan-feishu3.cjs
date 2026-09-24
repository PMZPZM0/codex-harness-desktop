// 降低阈值再扫 + 直接搜关键词上下文
const asar = require("@electron/asar");
const fs = require("fs");
const path = require("path");
if (!fs.existsSync("tmp-zcode-asar")) fs.mkdirSync("tmp-zcode-asar");
const src = "D:\\Users\\Administrator\\AppData\\Local\\Programs\\ZCode\\resources\\app.asar";
const list = asar.listPackage(src).map((p) => p.replace(/\\/g, "/")).filter((p) => p.startsWith("/out/") && p.endsWith(".js"));
let best = [];
for (const rel of list) {
  try {
    const t = asar.extractFile(src, rel.slice(1)).toString("utf8");
    const c = (t.match(/[Ff]eishu/g) || []).length + (t.match(/\b[Ll]ark\b/g) || []).length;
    if (c > 0) best.push({ rel, c, size: t.length });
  } catch { }
}
best.sort((a, b) => b.c - a.c);
console.log("files containing feishu/lark:", best.length);
best.slice(0, 12).forEach((b) => console.log(`${b.rel}: count=${b.c} size=${b.size}`));
// 提取前 3 名
for (const b of best.slice(0, 3)) {
  const t = asar.extractFile(src, b.rel.slice(1)).toString("utf8");
  fs.writeFileSync(path.join("tmp-zcode-asar", path.basename(b.rel)), t);
}
