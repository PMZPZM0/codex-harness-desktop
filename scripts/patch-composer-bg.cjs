// ComposerMenu 按钮主题背景修复（写文件执行）
const fs = require("fs");
let s = fs.readFileSync("src/styles.css", "utf8");
if (!s.includes("ButtonFace 白底")) {
  s += `
/* ── ComposerMenu 选择按钮：显式主题背景（防 UA 默认 ButtonFace 白底在暗色主题漏出）── */
.composer-setting {
  background: transparent;
  color-scheme: dark light;
}
.composer-setting:not(.danger):not(:hover):not(:disabled) {
  background: color-mix(in srgb, var(--panel-2) 55%, transparent);
}
`;
  fs.writeFileSync("src/styles.css", s);
  console.log("explicit bg appended");
} else console.log("already present");
