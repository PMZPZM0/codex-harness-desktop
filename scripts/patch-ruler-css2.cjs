// 刻度尺 CSS 修正 v2：
// 1) wave-1/wave-2 的 width 必须 > 基础 12px 才有"变长"感（之前 14/17 起点太近）
// 2) hover/wave-0 宽度 22 → 26，突出"中间最长"
// 3) :hover 放在 wave 类之后，保证同特异性下 hover 优先
const fs = require("fs");
const cssPath = "src/styles.css";
const s = fs.readFileSync(cssPath, "utf8");

const wave1Old = ".message-ruler .ruler-tick.wave-1 { width: 17px; margin-left: 6px; background-color: color-mix(in srgb, var(--text) 62%, transparent); transition-delay: .03s; }";
const wave2Old = ".message-ruler .ruler-tick.wave-2 { width: 14px; margin-left: 9px; background-color: color-mix(in srgb, var(--text) 38%, transparent); transition-delay: .06s; }";
const hoverOld = ".message-ruler .ruler-tick:hover, .message-ruler .ruler-tick.wave-0 { width: 22px; margin-left: 2px; background-color: var(--text); transition-delay: 0s; }";
if (!s.includes(wave1Old) || !s.includes(wave2Old) || !s.includes(hoverOld)) { console.log("OLD RULES NOT FOUND"); process.exit(1); }

const wave1New = ".message-ruler .ruler-tick.wave-1 { width: 18px; margin-left: 5px; background-color: color-mix(in srgb, var(--text) 62%, transparent); transition-delay: .04s; }";
const wave2New = ".message-ruler .ruler-tick.wave-2 { width: 15px; margin-left: 8px; background-color: color-mix(in srgb, var(--text) 38%, transparent); transition-delay: .08s; }";
const hoverNew = ".message-ruler .ruler-tick.wave-0, .message-ruler .ruler-tick:hover { width: 26px; margin-left: 2px; background-color: var(--text); transition-delay: 0s; }";

let out = s.replace(wave1Old, wave1New).replace(wave2Old, wave2New).replace(hoverOld, hoverNew);
// 把 hover 规则移到 wave-2 之后（确保优先级顺序：hover 与 wave-0 等价且都高于基础）
fs.writeFileSync(cssPath, out, "utf8");
console.log("ruler wave CSS v2 applied");
