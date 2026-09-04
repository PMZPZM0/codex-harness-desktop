// developer_instructions 尾段更新：告知指纹浏览器 + desktop_* MCP 直用 + 技能指引
const fs = require("fs");
let s = fs.readFileSync("electron/main.ts", "utf8");
const old = "Prefer playwright-cli for quick browsing; cloakbrowser for anti-bot sites; nuphus-call when you must operate the actual desktop or the user\\'s Chrome profile.\"\"\"";
if (!s.includes(old)) { console.log("TAIL NOT FOUND"); process.exit(1); }
const next = "The in-app browser panel is CloakBrowser (fingerprint Chromium) - pages opened there share its anti-detect profile. Desktop automation tools (desktop_*) are registered directly as MCP tools (server: nuphus) - call them natively; full usage guides are in your skills desktop-automation and browser-automation. Prefer playwright-cli for quick browsing; cloakbrowser for anti-bot sites; nuphus desktop_* tools when you must operate the actual desktop.\"\"\"";
fs.writeFileSync("electron/main.ts", s.replace(old, next));
console.log("instructions updated");
