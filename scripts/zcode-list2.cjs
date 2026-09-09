// 修正路径分隔符处理：listPackage 返回的是 \ 分隔，逐字符判断
const asar = require("@electron/asar");
const fs = require("fs");
const path = require("path");
if (!fs.existsSync("tmp-zcode-asar")) fs.mkdirSync("tmp-zcode-asar");
const src = "D:\\Users\\Administrator\\AppData\\Local\\Programs\\ZCode\\resources\\app.asar";
const list = asar.listPackage(src);
console.log("raw total:", list.length);
console.log("raw sample:", JSON.stringify(list.slice(0, 5)));
const normalized = list.map((p) => p.split(path.sep).join("/").replace(/^\/+/, "/"));
const out = normalized.filter((p) => p.startsWith("/out/"));
console.log("out files:", out.length);
console.log(out.slice(0, 8).join("\n"));
