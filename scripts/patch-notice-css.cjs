// 通知样式更新：顶部居中 toast + 三色分级 + 出入场动画
const fs = require("fs");
const cssPath = "src/styles.css";
const s = fs.readFileSync(cssPath, "utf8");
const oldRule = ".notice { position: fixed; right: 18px; bottom: 18px; z-index: 9999; max-width: min(460px, calc(100% - 36px)); min-height: 38px; padding: 8px 8px 8px 13px; display: flex; align-items: center; gap: 8px; border: 1px solid #f2cfc9; border-radius: 12px; background: #fdf0ee; color: #b3423a; font-size: 12px; box-shadow: 0 14px 40px rgba(0, 0, 0, .22); }";
if (!s.includes(oldRule)) { console.log("OLD RULE NOT FOUND"); process.exit(1); }
const next = `/* 通知 toast：顶部居中，自动消失；按语气分三色（成功绿/错误红/普通中性） */
.notice { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 9999; max-width: min(480px, calc(100% - 36px)); min-height: 36px; padding: 7px 8px 7px 13px; display: flex; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 999px; background: var(--panel); color: var(--text); font-size: 12px; box-shadow: 0 10px 34px rgba(0, 0, 0, .16); animation: notice-in .22s cubic-bezier(.22,.61,.36,1) both; }
.notice.error { border-color: color-mix(in srgb, var(--red) 45%, transparent); background: color-mix(in srgb, var(--red) 8%, var(--panel)); color: var(--red); }
.notice.success { border-color: color-mix(in srgb, var(--green) 45%, transparent); background: color-mix(in srgb, var(--green) 9%, var(--panel)); color: color-mix(in srgb, var(--green) 80%, var(--text)); }
@keyframes notice-in { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }`;
fs.writeFileSync(cssPath, s.replace(oldRule, next), "utf8");
console.log("notice CSS updated");
