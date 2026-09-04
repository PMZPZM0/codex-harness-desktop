// CompletedChanges 块淡入：完成瞬间插入时高度变化更柔和（高度动画 + 透明度）
const fs = require("fs");
const cssPath = "src/styles.css";
const s = fs.readFileSync(cssPath, "utf8");
const anchor = ".completed-changes { margin: 0 0 8px; overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); font-size: 12px; }";
if (!s.includes(anchor)) { console.log("ANCHOR NOT FOUND"); process.exit(1); }
const next = `.completed-changes { margin: 0 0 8px; overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); font-size: 12px; animation: block-grow .34s cubic-bezier(.22,.61,.36,1) both; }
@keyframes block-grow { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }`;
fs.writeFileSync(cssPath, s.replace(anchor, next), "utf8");
console.log("completed-changes fade CSS added");
