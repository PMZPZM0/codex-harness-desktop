// 欢迎页布局 v2：问候语区在 composer 上方 1/3 处居中；水印在问候语后面
const fs = require("fs");
const cssPath = "src/styles.css";
const s = fs.readFileSync(cssPath, "utf8");

const anchor = ".welcome-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; position: relative; margin: auto 0; animation: welcome-in .34s cubic-bezier(.22,.61,.36,1) both; }";
if (!s.includes(anchor)) { console.log("ANCHOR NOT FOUND"); process.exit(1); }
// composer 停靠在 46%，问候语区放在上方约 22% 高度处（justify-content 用 padding-bottom 压上去）
const next = `/* 欢迎页：问候语区位于 composer 停靠位上方（约 22% 视高处），水印紧贴问候语上方 */
.welcome-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; position: relative; margin: auto 0; padding-bottom: 34vh; animation: welcome-in .34s cubic-bezier(.22,.61,.36,1) both; }`;
fs.writeFileSync(cssPath, s.replace(anchor, next), "utf8");
console.log("welcome v2 layout applied");
