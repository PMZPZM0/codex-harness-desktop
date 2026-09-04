// 一次性 CSS 更新：深度思考卡片平滑过渡 + stream-plain 样式
const fs = require("fs");
const cssPath = "src/styles.css";
const s = fs.readFileSync(cssPath, "utf8");
const marker = "/* 深度思考卡片：进行中展开流式，完成自动折叠 */";
const start = s.indexOf(marker);
if (start < 0) { console.log("MARKER NOT FOUND"); process.exit(1); }
// 该段到 .reasoning-body 行结束
const endMarker = ".reasoning-card .reasoning-body { color: var(--muted); font-size: 12.5px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }";
const end = s.indexOf(endMarker);
if (end < 0) { console.log("END NOT FOUND"); process.exit(1); }
const next = `/* 深度思考卡片：live/done 仅换配色不换 DOM；展开收起平滑过渡 */
.reasoning-card { margin: 4px 0 8px; border: 1px solid var(--line-soft); border-radius: 10px; background: var(--panel); overflow: hidden; transition: border-color .3s ease, background-color .3s ease; }
.reasoning-card.live { border-color: color-mix(in srgb, var(--orange) 30%, transparent); background: color-mix(in srgb, var(--orange) 6%, var(--panel)); }
.reasoning-card.done { border-color: var(--line-soft); background: var(--panel); }
.reasoning-card > summary { display: flex; align-items: center; gap: 7px; min-height: 34px; padding: 0 12px; cursor: pointer; list-style: none; color: var(--muted); font-size: 12px; user-select: none; }
.reasoning-card > summary::-webkit-details-marker { display: none; }
.reasoning-card .reasoning-head { display: inline-flex; align-items: center; gap: 6px; flex: 1; color: var(--muted); font-size: 11.5px; transition: color .3s ease; }
.reasoning-card.live .reasoning-head { color: var(--orange); }
.reasoning-card .reasoning-caret { color: var(--faint); transition: transform .18s ease; }
.reasoning-card[open] .reasoning-caret { transform: rotate(180deg); }
.reasoning-card .reasoning-body-wrap { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .3s cubic-bezier(.22,.61,.36,1); }
.reasoning-card[open] > .reasoning-body-wrap { grid-template-rows: 1fr; }
.reasoning-card .reasoning-body { min-height: 0; overflow-y: auto; max-height: 240px; margin: 0 12px 10px; padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, var(--panel-2, var(--panel)) 72%, transparent); color: var(--muted); font-size: 12.5px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; scrollbar-width: thin; }
/* 流式中的回复正文：纯文本直出（完成后切换 Markdown 渲染），字号行高与正式段落一致避免切换跳动 */
.stream-plain { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--sans-font-size, 14px); line-height: 1.7; color: var(--text); }`;
fs.writeFileSync(cssPath, s.slice(0, start) + next + s.slice(end + endMarker.length), "utf8");
console.log("CSS updated OK, new bytes:", next.length);
