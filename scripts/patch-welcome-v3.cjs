// 欢迎页 v3：问候语+水印整体抬到 composer 上方不重叠
// composer 停靠 top 46%（271px 处），问候语需在 250px 之上结束 → padding-bottom 提到 40vh，
// 水印改回 absolute（在问候语上方 -110px 居中），不占流式高度。
const fs = require("fs");
const cssPath = "src/styles.css";
const s = fs.readFileSync(cssPath, "utf8");

const stateAnchor = ".welcome-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; position: relative; margin: auto 0; padding-bottom: 34vh; animation: welcome-in .34s cubic-bezier(.22,.61,.36,1) both; }";
const markAnchor = ".welcome-mark { position: static; margin: 0 auto 8px; color: var(--text); opacity: .07; user-select: none; pointer-events: none; display: flex; justify-content: center; }";
if (!s.includes(stateAnchor) || !s.includes(markAnchor)) { console.log("ANCHORS NOT FOUND", s.includes(stateAnchor), s.includes(markAnchor)); process.exit(1); }
const stateNext = "/* 欢迎页：问候语在 composer 停靠位上方；水印悬浮在问候语上方不占流 */\n.welcome-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; position: relative; margin: auto 0; padding-bottom: 42vh; animation: welcome-in .34s cubic-bezier(.22,.61,.36,1) both; }";
const markNext = ".welcome-mark { position: absolute; bottom: calc(100% + 2px); left: 50%; transform: translateX(-50%); color: var(--text); opacity: .07; user-select: none; pointer-events: none; }";
fs.writeFileSync(cssPath, s.replace(stateAnchor, stateNext).replace(markAnchor, markNext), "utf8");
console.log("welcome v3 applied");
