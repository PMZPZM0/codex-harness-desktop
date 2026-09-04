// weixin-gateway baseUrl 修复（CRLF 安全）
const fs = require("fs");
let s = fs.readFileSync("electron/weixin-gateway.ts", "utf8");
const lines = s.split(/\r?\n/);

// 1) 登录 confirmed 分支
const li = lines.findIndex((l) => l.includes("this.baseUrl = response.baseurl ?"));
if (li < 0) { console.log("L1 NOT FOUND"); process.exit(1); }
lines.splice(li, 1,
  '        // openclaw-weixin 的 baseurl 已含协议前缀（https://ilinkai.weixin.qq.com），不能重复拼接',
  '        const rawBase = String(response.baseurl ?? "");',
  '        this.baseUrl = rawBase.startsWith("http") ? rawBase : rawBase ? `https://${rawBase}` : ILINK_BASE;');

// 2) resume 分支
const ri = lines.findIndex((l) => l.includes("this.baseUrl = raw.baseUrl ?? ILINK_BASE;"));
if (ri >= 0) {
  lines.splice(ri, 1,
    '        // 兼容早期持久化的双重前缀坏数据',
    '        const savedBase = String(raw.baseUrl ?? "").replace(/^(https?:\\/\\/)+/, "https://");',
    '        this.baseUrl = savedBase || ILINK_BASE;');
}

fs.writeFileSync("electron/weixin-gateway.ts", lines.join("\r\n"));
const check = fs.readFileSync("electron/weixin-gateway.ts", "utf8");
console.log("base fix:", check.includes("rawBase.startsWith"), "| resume fix:", check.includes("双重前缀"));
