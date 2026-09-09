// 从 ZCode asar 找飞书/lark bot 相关源码文件
const asar = require("@electron/asar");
const fs = require("fs");
const src = "D:\\Users\\Administrator\\AppData\\Local\\Programs\\ZCode\\resources\\app.asar";
const list = asar.listPackage(src).map((p) => p.replace(/\\/g, "/"));
const hits = list.filter((p) => /feishu|lark/i.test(p) && !p.includes("node_modules"));
console.log("non-node_modules feishu/lark files:", hits.length);
hits.slice(0, 40).forEach((p) => console.log(p));
// 也搜 host 侧（out/host）与 main
const host = list.filter((p) => p.startsWith("/out/") && /feishu|lark/i.test(p));
console.log("--- out/ feishu/lark ---");
host.slice(0, 40).forEach((p) => console.log(p));
