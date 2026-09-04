// 机器人绑定面板 v2：二维码白底固定方块（码不叠字），状态信息右侧竖排卡片，整体像正规绑定 UI
const fs = require("fs");
const cssPath = "src/styles.css";
const s = fs.readFileSync(cssPath, "utf8");
const anchor = `/* 机器人扫码绑定卡 */
.bot-bind-wrap { display: grid; gap: 10px; }
.bot-bind-card { align-items: flex-start; }
.bot-scan-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 14px; border: 1px solid var(--line); border-radius: 9px; background: var(--panel); color: var(--text); cursor: pointer; font-size: 12.5px; }
.bot-scan-btn:hover { background: var(--panel-2); }
.bot-bind-panel { display: flex; align-items: center; gap: 14px; padding: 12px; border: 1px dashed var(--line); border-radius: 12px; background: color-mix(in srgb, var(--panel-2, var(--panel)) 55%, transparent); }
.bot-bind-panel .remote-qr-box { width: 150px; flex: 0 0 auto; padding: 8px; border-radius: 10px; background: #fff; }
.bot-bind-state { display: flex; flex-direction: column; gap: 8px; color: var(--muted); font-size: 12.5px; line-height: 1.6; }
.bot-bind-state .remote-mini-btn { width: max-content; }
.bind-spinner { width: 12px; height: 12px; border: 2px solid var(--line); border-top-color: var(--text); border-radius: 50%; animation: spin 1s linear infinite; display: inline-block; }
.bind-ok { color: var(--green); font-weight: 600; font-size: 13px; }`;
if (!s.includes(anchor)) { console.log("ANCHOR NOT FOUND"); process.exit(1); }
const next = `/* 机器人扫码绑定卡：二维码独立白底块，状态文字右侧竖排，永不重叠 */
.bot-bind-wrap { display: grid; gap: 10px; }
.bot-bind-card { align-items: flex-start; }
.bot-scan-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 14px; border: 1px solid var(--line); border-radius: 9px; background: var(--panel); color: var(--text); cursor: pointer; font-size: 12.5px; white-space: nowrap; }
.bot-scan-btn:hover { background: var(--panel-2); }
.bot-bind-panel { display: flex; align-items: flex-start; gap: 16px; padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }
.bot-bind-panel .remote-qr-box { width: 168px; flex: 0 0 auto; padding: 10px; border: 1px solid var(--line-soft); border-radius: 12px; background: #fff; }
.bot-bind-panel .remote-qr-box svg { display: block; width: 100%; height: auto; }
.bot-bind-state { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; padding-top: 4px; color: var(--muted); font-size: 12.5px; line-height: 1.65; }
.bot-bind-state .remote-mini-btn { width: max-content; }
.bot-bind-state-title { display: inline-flex; align-items: center; gap: 8px; color: var(--text); font-weight: 600; font-size: 13px; }
.bind-spinner { width: 13px; height: 13px; border: 2px solid var(--line); border-top-color: var(--text); border-radius: 50%; animation: spin 1s linear infinite; display: inline-block; flex: 0 0 auto; }
.bind-ok { color: var(--green); font-weight: 600; font-size: 13px; }`;
fs.writeFileSync(cssPath, s.replace(anchor, next), "utf8");
console.log("bind panel CSS v2 applied");
