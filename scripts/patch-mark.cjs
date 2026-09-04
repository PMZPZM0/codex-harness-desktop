// 水印修正：缩小尺寸（JSX 170→96）改 CSS 定位，贴在问候语上方且不越顶
const fs = require("fs");
const cssPath = "src/styles.css";
const s = fs.readFileSync(cssPath, "utf8");
const anchor = ".welcome-mark { position: absolute; bottom: calc(100% + 2px); left: 50%; transform: translateX(-50%); color: var(--text); opacity: .07; user-select: none; pointer-events: none; }";
if (!s.includes(anchor)) { console.log("ANCHOR NOT FOUND"); process.exit(1); }
const next = ".welcome-mark { position: absolute; bottom: calc(100% - 6px); left: 50%; transform: translateX(-50%); color: var(--text); opacity: .07; user-select: none; pointer-events: none; max-height: 120px; overflow: visible; }";
fs.writeFileSync(cssPath, s.replace(anchor, next), "utf8");
console.log("mark css adjusted");
