// footer 平滑淡入：完成瞬间 token 行/操作条出现时不再突跳
const fs = require("fs");
const cssPath = "src/styles.css";
const s = fs.readFileSync(cssPath, "utf8");
const anchor = ".message-footer { justify-content: flex-end; }";
if (!s.includes(anchor)) { console.log("ANCHOR NOT FOUND"); process.exit(1); }
const next = `.message-footer { justify-content: flex-end; }
/* 完成瞬间 footer（token 行/操作）从无到有：淡入占位，避免高度突跳 */
.codex-turn .assistant-message .message-footer { animation: footer-in .3s ease both; }
@keyframes footer-in { from { opacity: 0; } to { opacity: 1; } }`;
fs.writeFileSync(cssPath, s.replace(anchor, next), "utf8");
console.log("footer fade-in CSS added");
