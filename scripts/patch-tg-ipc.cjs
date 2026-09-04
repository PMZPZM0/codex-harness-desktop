// preload + types 补 telegram IPC
const fs = require("fs");
let p = fs.readFileSync("electron/preload.ts", "utf8");
const pAnchor = 'weixinStatus: () => ipcRenderer.invoke("weixin:status") as Promise<{ bound: boolean }>,';
if (!p.includes(pAnchor)) { console.log("preload anchor missing"); process.exit(1); }
if (!p.includes("telegramConnect")) {
  p = p.replace(pAnchor, pAnchor + '\n  telegramConnect: (token: string) => ipcRenderer.invoke("telegram:connect", token) as Promise<{ ok: boolean; username?: string; error?: string }>,\n  telegramStatus: () => ipcRenderer.invoke("telegram:status") as Promise<{ bound: boolean }>,');
  fs.writeFileSync("electron/preload.ts", p);
}
let v = fs.readFileSync("src/vite-env.d.ts", "utf8");
const vAnchor = "weixinStatus(): Promise<{ bound: boolean }>;";
if (!v.includes(vAnchor)) { console.log("types anchor missing"); process.exit(1); }
if (!v.includes("telegramConnect")) {
  v = v.replace(vAnchor, vAnchor + '\n    telegramConnect(token: string): Promise<{ ok: boolean; username?: string; error?: string }>;\n    telegramStatus(): Promise<{ bound: boolean }>;');
  fs.writeFileSync("src/vite-env.d.ts", v);
}
console.log("preload+types telegram done");
