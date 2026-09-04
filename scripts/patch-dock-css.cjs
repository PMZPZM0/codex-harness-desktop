// 欢迎页 ZCode 式布局：composer 欢迎态居中停靠（chips 在输入框下方），发消息后平滑过渡回底部
const fs = require("fs");
const cssPath = "src/styles.css";
const s = fs.readFileSync(cssPath, "utf8");

const wrapAnchor = '.composer-wrap { position: relative; z-index: 3; width: min(820px, calc(100% - 46px)); margin: 0 auto 22px; }';
if (!s.includes(wrapAnchor)) { console.log("WRAP ANCHOR NOT FOUND"); process.exit(1); }
const wrapNext = `/* composer 常态：文档流底部；欢迎态（docked-center）：绝对定位居中停靠，发消息后 transition 回底部 */
.composer-wrap { position: relative; z-index: 3; width: min(820px, calc(100% - 46px)); margin: 0 auto 22px; }
.composer-wrap.docked-center { position: absolute; left: 50%; bottom: auto; top: 46%; transform: translate(-50%, -50%); width: min(680px, calc(100% - 60px)); margin: 0; }
.composer-wrap.docked-center .composer { min-height: 96px; box-shadow: 0 18px 44px rgba(0, 0, 0, .07); }
.composer-wrap.docked-center .suggest-row { margin-top: 14px; justify-content: center; }
/* 位置过渡：居中 ⇄ 底部 0.34s 丝滑切换 */
.composer-wrap { transition: width .34s cubic-bezier(.22,.61,.36,1); }
.composer-wrap.docked-center { transition: top .34s cubic-bezier(.22,.61,.36,1), transform .34s cubic-bezier(.22,.61,.36,1), width .34s cubic-bezier(.22,.61,.36,1); }`;
let out = s.replace(wrapAnchor, wrapNext);

// 欢迎页：水印移到问候上方居中（原 absolute 右上），整体上移一点给 composer 留中位
const wsAnchor = ".welcome-mark { position: absolute; top: 34px; right: 8%; color: var(--text); opacity: .06; user-select: none; pointer-events: none; }";
if (out.includes(wsAnchor)) {
  const wsNext = ".welcome-mark { position: static; margin: 0 auto 8px; color: var(--text); opacity: .07; user-select: none; pointer-events: none; display: flex; justify-content: center; }";
  out = out.replace(wsAnchor, wsNext);
} else console.log("welcome-mark anchor changed, keeping as is");
// 欢迎态 watermark 更大（由 JSX size 控制），居中排列
fs.writeFileSync(cssPath, out, "utf8");
console.log("welcome/composer dock CSS applied");
