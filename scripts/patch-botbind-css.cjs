// 机器人绑定卡 + 详情行样式
const fs = require("fs");
const cssPath = "src/styles.css";
const s = fs.readFileSync(cssPath, "utf8");
const anchor = ".bot-delete-row";
if (!s.includes(anchor)) { console.log("ANCHOR NOT FOUND"); process.exit(1); }
const insert = `/* 机器人扫码绑定卡 */
.bot-bind-wrap { display: grid; gap: 10px; }
.bot-bind-card { align-items: flex-start; }
.bot-scan-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 14px; border: 1px solid var(--line); border-radius: 9px; background: var(--panel); color: var(--text); cursor: pointer; font-size: 12.5px; }
.bot-scan-btn:hover { background: var(--panel-2); }
.bot-bind-panel { display: flex; align-items: center; gap: 14px; padding: 12px; border: 1px dashed var(--line); border-radius: 12px; background: color-mix(in srgb, var(--panel-2, var(--panel)) 55%, transparent); }
.bot-bind-panel .remote-qr-box { width: 150px; flex: 0 0 auto; padding: 8px; border-radius: 10px; background: #fff; }
.bot-bind-state { display: flex; flex-direction: column; gap: 8px; color: var(--muted); font-size: 12.5px; line-height: 1.6; }
.bot-bind-state .remote-mini-btn { width: max-content; }
.bind-spinner { width: 12px; height: 12px; border: 2px solid var(--line); border-top-color: var(--text); border-radius: 50%; animation: spin 1s linear infinite; display: inline-block; }
.bind-ok { color: var(--green); font-weight: 600; font-size: 13px; }
.bot-detail-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 14px; border: 1px solid var(--line-soft); border-radius: 12px; background: var(--panel); }
.bot-detail-row > div { display: grid; gap: 3px; }
.bot-detail-row strong { font-size: 13px; }
.bot-detail-row small { color: var(--muted); font-size: 11.5px; line-height: 1.5; }
.bot-select { min-height: 34px; padding: 0 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); color: var(--text); font-size: 12.5px; }
`;
fs.writeFileSync(cssPath, s.replace(anchor, insert + "\n" + anchor), "utf8");
console.log("bot bind CSS added");
