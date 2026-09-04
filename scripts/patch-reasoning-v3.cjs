// 思考卡 UI v3：更精致的视觉（渐变边框、时间线圆点、更舒适的排版）
const fs = require("fs");
const cssPath = "src/styles.css";
const s = fs.readFileSync(cssPath, "utf8");
const marker = "/* 深度思考卡片：live/done 仅换配色不换 DOM；展开收起平滑过渡 */";
const start = s.indexOf(marker);
if (start < 0) { console.log("MARKER NOT FOUND"); process.exit(1); }
const endMarker = ".stream-plain { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--sans-font-size, 14px); line-height: 1.7; color: var(--text); }";
const end = s.indexOf(endMarker);
if (end < 0) { console.log("END NOT FOUND"); process.exit(1); }
const next = `/* 深度思考卡：常驻于回复上方；live 橙色呼吸、done 安静灰；引用式左边线 + 时间线圆点 */
.reasoning-card { margin: 6px 0 10px; border: 1px solid var(--line-soft); border-left: 3px solid var(--line); border-radius: 10px; background: linear-gradient(180deg, color-mix(in srgb, var(--panel-2, var(--panel)) 45%, transparent), var(--panel)); overflow: hidden; transition: border-color .3s ease, background-color .3s ease, border-left-color .3s ease; }
.reasoning-card.live { border-color: color-mix(in srgb, var(--orange) 26%, transparent); border-left-color: var(--orange); background: linear-gradient(180deg, color-mix(in srgb, var(--orange) 7%, transparent), var(--panel)); }
.reasoning-card.done { border-left-color: color-mix(in srgb, var(--muted) 45%, transparent); }
.reasoning-card > summary { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 12px; cursor: pointer; list-style: none; color: var(--muted); font-size: 12px; user-select: none; }
.reasoning-card > summary::-webkit-details-marker { display: none; }
.reasoning-card .reasoning-head { display: inline-flex; align-items: center; gap: 7px; flex: 1; color: var(--muted); font-size: 11.5px; letter-spacing: .2px; transition: color .3s ease; }
.reasoning-card.live .reasoning-head { color: var(--orange); font-weight: 500; }
.reasoning-card .reasoning-caret { color: var(--faint); transition: transform .18s ease; }
.reasoning-card[open] .reasoning-caret { transform: rotate(180deg); }
.reasoning-card .reasoning-body-wrap { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .3s cubic-bezier(.22,.61,.36,1); }
.reasoning-card[open] > .reasoning-body-wrap { grid-template-rows: 1fr; }
.reasoning-card .reasoning-body { min-height: 0; overflow-y: auto; max-height: 260px; margin: 0 12px 12px; padding: 10px 12px; border-left: 2px solid color-mix(in srgb, var(--line) 80%, transparent); border-radius: 0 8px 8px 0; background: color-mix(in srgb, var(--panel-2, var(--panel)) 60%, transparent); color: var(--muted); font-size: 12.5px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; scrollbar-width: thin; }
/* 流式中的回复正文：纯文本直出（完成后切换 Markdown 渲染），字号行高与正式段落一致避免切换跳动 */
.stream-plain { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--sans-font-size, 14px); line-height: 1.7; color: var(--text); }`;
fs.writeFileSync(cssPath, s.slice(0, start) + next + s.slice(end + endMarker.length), "utf8");
console.log("reasoning card UI v3 applied");
