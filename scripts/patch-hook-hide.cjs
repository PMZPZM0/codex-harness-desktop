// Hook 徽标默认隐藏：图标平时透明（占位），hover footer 时才显形；弹层跟随 hover
const fs = require("fs");
let s = fs.readFileSync("src/styles.css", "utf8");
if (!s.includes("hook-badge 默认隐藏")) {
  s += `
/* ── Hook 徽标默认隐藏：hover 消息 footer 时才显形 ── */
.message-footer .hook-badge-wrap { opacity: 0; transition: opacity .15s ease; }
.message-footer:hover .hook-badge-wrap { opacity: 1; }
`;
  fs.writeFileSync("src/styles.css", s);
}
console.log("hook badge hidden-by-default css ok");
