// 思考卡 UI v3（适配被格式化过的 CSS：按选择器定位、追加覆盖规则在文件尾）
const fs = require("fs");
const cssPath = "src/styles.css";
let s = fs.readFileSync(cssPath, "utf8");
// 直接把 v3 覆盖规则追加到文件末尾（同特异性后者胜，稳妥且不依赖格式）
const append = `
/* ── 深度思考卡 UI v3：常驻回复上方；live 橙色呼吸、done 安静灰；引用式左边线 ── */
.reasoning-card {
  margin: 6px 0 10px;
  border: 1px solid var(--line-soft);
  border-left: 3px solid color-mix(in srgb, var(--muted) 45%, transparent);
  border-radius: 10px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--panel-2, var(--panel)) 45%, transparent), var(--panel));
  overflow: hidden;
  transition: border-color 0.3s ease, border-left-color 0.3s ease, background-color 0.3s ease;
}
.reasoning-card.live {
  border-color: color-mix(in srgb, var(--orange) 26%, transparent);
  border-left-color: var(--orange);
  background: linear-gradient(180deg, color-mix(in srgb, var(--orange) 7%, transparent), var(--panel));
}
.reasoning-card .reasoning-head {
  letter-spacing: 0.2px;
}
.reasoning-card.live .reasoning-head {
  font-weight: 500;
}
.reasoning-card .reasoning-body {
  border-left: 2px solid color-mix(in srgb, var(--line) 80%, transparent);
  border-radius: 0 8px 8px 0;
  margin: 0 12px 12px;
  padding: 10px 12px;
  line-height: 1.8;
  max-height: 260px;
}
`;
if (!s.includes("深度思考卡 UI v3")) {
  s += append;
  fs.writeFileSync(cssPath, s, "utf8");
}
console.log("reasoning v3 appended");
