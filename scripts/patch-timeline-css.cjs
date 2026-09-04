// timeline 空态 flex 化：welcome 存在时 timeline 变 flex 列容器，让 welcome margin:auto 垂直居中。
// React 侧给 timeline 加 class 更可控 —— 这里直接补 CSS 规则，配合 JSX 里的条件 class。
const fs = require("fs");
const cssPath = "src/styles.css";
const s = fs.readFileSync(cssPath, "utf8");
const anchor = ".timeline { flex: 1 1 0; width: 0; min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 28px max(23px, calc((100% - 820px) / 2)) 28px; scroll-behavior: smooth; }";
if (!s.includes(anchor)) { console.log("ANCHOR NOT FOUND"); process.exit(1); }
const next = anchor + "\n/* 空态欢迎页：flex 列 + margin auto 实现真正视口居中 */\n.timeline.empty-state { display: flex; flex-direction: column; }";
fs.writeFileSync(cssPath, s.replace(anchor, next), "utf8");
console.log("timeline empty-state rule added");
