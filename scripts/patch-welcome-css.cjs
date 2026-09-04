// 欢迎页改造 CSS：
// 1) 空态时 timeline 用 flex 把欢迎页推到正中（不受 spacer/padding 干扰）
// 2) 欢迎页 → 对话切换的淡入过渡
// 3) 欢迎页元素入场节奏（mark/greet/chips 依次浮现）
const fs = require("fs");
const cssPath = "src/styles.css";
const s = fs.readFileSync(cssPath, "utf8");

const anchor = ".welcome-state { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding-bottom: 8vh; position: relative; }";
if (!s.includes(anchor)) { console.log("WELCOME ANCHOR NOT FOUND"); process.exit(1); }
const next = `/* 空态：timeline 是 flex 容器，欢迎块 margin auto 实现真正的视口居中（不受滚动位置影响） */
.welcome-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; position: relative; margin: auto 0; animation: welcome-in .34s cubic-bezier(.22,.61,.36,1) both; }
@keyframes welcome-in { from { opacity: 0; transform: translateY(10px) scale(.985); } to { opacity: 1; transform: none; } }
/* 对话内容切换进入：欢迎页消失后回合卡片柔顺浮现 */
.timeline .turn-group { animation: turn-appear .3s cubic-bezier(.22,.61,.36,1) both; }`;
fs.writeFileSync(cssPath, s.replace(anchor, next), "utf8");
console.log("welcome CSS updated");
