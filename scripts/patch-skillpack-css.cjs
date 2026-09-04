// 写代码模式卡片样式
const fs = require("fs");
let s = fs.readFileSync("src/styles.css", "utf8");
if (!s.includes(".skill-pack-card")) {
  s += `
/* ── 写代码模式（ponytail 技能包）卡片 ── */
.skill-pack-card { display: flex; align-items: center; gap: 14px; padding: 13px 15px; border: 1px solid color-mix(in srgb, var(--green) 30%, transparent); border-radius: 12px; background: color-mix(in srgb, var(--green) 5%, var(--panel)); }
.skill-pack-card .skill-pack-main { flex: 1; display: grid; gap: 4px; }
.skill-pack-card strong { font-size: 13px; }
.skill-pack-card small { color: var(--muted); font-size: 11.5px; line-height: 1.55; }
`;
  fs.writeFileSync("src/styles.css", s);
}
console.log("skill pack css ok");
