// 刻度尺 CSS 重写：密集间距 + 波浪 hover + 隐藏 timeline 滚动条
const fs = require("fs");
const cssPath = "src/styles.css";
const s = fs.readFileSync(cssPath, "utf8");

// 1) timeline 隐藏滚动条（滚轮功能保留）
const tlAnchor = ".timeline { flex: 1 1 0; width: 0; min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 28px max(23px, calc((100% - 820px) / 2)) 28px; scroll-behavior: smooth; }";
if (!s.includes(tlAnchor)) { console.log("TIMELINE ANCHOR NOT FOUND"); process.exit(1); }
const tlNext = tlAnchor + "\n/* 隐藏滚动条但保留滚轮：定位交给左侧消息刻度尺 */\n.timeline { scrollbar-width: none; }\n.timeline::-webkit-scrollbar { display: none; }";

// 2) 刻度尺区块重写
const oldStart = s.indexOf(".message-ruler {");
const oldEndMarker = "pointer-events: none; z-index: 20; animation: ruler-tip-in .14s ease; }";
const oldEnd = s.indexOf(oldEndMarker);
if (oldStart < 0 || oldEnd < 0) { console.log("RULER BLOCK NOT FOUND"); process.exit(1); }
const rulerNext = `/* 消息刻度尺：隐藏滚动条的滚轮区。刻度密集（4px 缝），hover 波浪：中心最长向对话框侧伸展，上下按距离衰减、错峰过渡 */
.message-ruler { position: absolute; left: 0; top: 0; bottom: 0; width: 30px; z-index: 4; pointer-events: none; }
.message-ruler .ruler-track { position: absolute; left: 0; right: 0; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 4px; }
/* 点击热区 10px（上下各 4px 透明 padding），可见线 2px（background-clip: content-box） */
.message-ruler .ruler-tick { position: relative; flex: 0 0 auto; box-sizing: content-box; width: 12px; height: 2px; padding: 4px 0; margin-left: 12px; border: 0; border-radius: 1px; background: color-mix(in srgb, var(--muted) 70%, transparent); background-clip: content-box; cursor: pointer; pointer-events: auto; transition: width .26s cubic-bezier(.22,.61,.36,1), margin-left .26s cubic-bezier(.22,.61,.36,1), background-color .22s ease; }
.message-ruler .ruler-tick.latest, .message-ruler .ruler-tick.current { background-color: color-mix(in srgb, var(--text) 80%, transparent); }
/* 波浪：hover 中心最长且右伸（靠对话框侧），邻层衰减 + 微延迟，移动鼠标时呈丝滑波浪 */
.message-ruler .ruler-tick:hover, .message-ruler .ruler-tick.wave-0 { width: 22px; margin-left: 2px; background-color: var(--text); transition-delay: 0s; }
.message-ruler .ruler-tick.wave-1 { width: 17px; margin-left: 6px; background-color: color-mix(in srgb, var(--text) 62%, transparent); transition-delay: .03s; }
.message-ruler .ruler-tick.wave-2 { width: 14px; margin-left: 9px; background-color: color-mix(in srgb, var(--text) 38%, transparent); transition-delay: .06s; }
.message-ruler .ruler-tip { position: absolute; left: 26px; width: max-content; max-width: 300px; transform: translateY(-50%); padding: 8px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); box-shadow: var(--shadow); font-size: 12.5px; line-height: 1.55; color: var(--text); text-align: left; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 5; white-space: pre-wrap; word-break: break-word; overflow: hidden; pointer-events: none; z-index: 20; animation: ruler-tip-in .14s ease; }`;

let out = s.replace(tlAnchor, tlNext);
out = out.slice(0, out.indexOf(".message-ruler {")) + rulerNext + out.slice(out.indexOf(oldEndMarker) + oldEndMarker.length);
fs.writeFileSync(cssPath, out, "utf8");
console.log("ruler CSS rewritten OK");
