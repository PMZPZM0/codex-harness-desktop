// Hook 徽标样式 + 注入脉冲反馈
const fs = require("fs");
let s = fs.readFileSync("src/styles.css", "utf8");
if (!s.includes(".hook-badge-wrap")) {
  s += `
/* ── Hook 注入徽标：footer 末尾小钩子，hover 弹明细；注入瞬间脉冲一次 ── */
.hook-badge-wrap { position: relative; display: inline-flex; align-items: center; }
.hook-badge { display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border-radius: 9px; font-size: 11px; color: var(--muted); background: color-mix(in srgb, var(--panel-2, var(--panel)) 80%, transparent); border: 1px solid var(--line-soft); cursor: default; }
.hook-badge.running { color: var(--orange); border-color: color-mix(in srgb, var(--orange) 35%, transparent); animation: hook-pulse 1.1s ease-in-out infinite; }
.hook-badge.done { animation: hook-pop .35s ease both; }
@keyframes hook-pulse { 0%, 100% { opacity: .65; } 50% { opacity: 1; } }
@keyframes hook-pop { 0% { transform: scale(.8); opacity: 0; } 60% { transform: scale(1.12); } 100% { transform: scale(1); opacity: 1; } }
.hook-badge-pop { position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 30; display: flex; flex-direction: column; gap: 4px; min-width: 200px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); box-shadow: var(--shadow); }
.hook-badge-row { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--text); white-space: nowrap; }
.hook-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--orange); flex: 0 0 auto; }
.hook-dot.ok { background: var(--green); }
`;
  fs.writeFileSync("src/styles.css", s);
}
console.log("hook badge css ok");
