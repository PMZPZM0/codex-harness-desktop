// 正确路径后重扫 feishu/lark（out/ 全部 js）
const asar = require("@electron/asar");
const fs = require("fs");
const path = require("path");
if (!fs.existsSync("tmp-zcode-asar")) fs.mkdirSync("tmp-zcode-asar");
const src = "D:\\Users\\Administrator\\AppData\\Local\\Programs\\ZCode\\resources\\app.asar";
const list = asar.listPackage(src).map((p) => p.split(path.sep).join("/"));
const out = list.filter((p) => p.startsWith("/out/") && p.endsWith(".js"));
console.log("scanning", out.length, "js files");
let best = [];
for (const rel of out) {
  try {
    const t = asar.extractFile(src, rel).toString("utf8");
    const c = (t.match(/[Ff]eishu/g) || []).length + (t.match(/\b[Ll]ark\b/g) || []).length;
    if (c > 0) best.push({ rel, c, size: t.length });
  } catch { }
}
best.sort((a, b) => b.c - a.c);
console.log("files containing feishu/lark:", best.length);
best.slice(0, 15).forEach((b) => console.log(`${b.rel}: count=${b.c} size=${b.size}`));
for (const b of best.slice(0, 4)) {
  const t = asar.extractFile(src, b.rel).toString("utf8");
  fs.writeFileSync(path.join("tmp-zcode-asar", path.basename(b.rel)), t);
}
