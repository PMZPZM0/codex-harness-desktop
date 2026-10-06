/**
 * 输入框上下拖动把手判据（10-06 夜三轮立；用户对照 Qoder 图二：「输入框加一个上下拖动功能，
 * 最高能拖动的高度记得设置好，还有最低的」）。
 *
 * 失效方式全是静默的：把手在但拖不动（没接线）、上下限丢了（能拖成 0px 或吃掉整个消息区）、
 * 拖了但输入区高度不动（变量没被样式消费）—— tsc 与预检都看不见。
 * 本守卫钉**代码形态与常量**；行为（真拖、钳上下限、双击复位、持久化）由验收 `composer-resize` 真跑。
 * 独立守卫（不进 check-preflight 的 checks 计数）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【composer-resize】${message}`);
  if (!condition) fails++;
};

const form = codeOnly(read("src/features/app-view/AppView/02-main-stage/03-composer/02-composer-form.tsx"));
const css = read("src/styles/04-cards-tools.css");

ok(form.includes('className="composer-resize-handle"') && form.includes("onPointerDown={onResizePointerDown}") && form.includes("onDoubleClick={onResizeDoubleClick}"),
  "把手在：pointerdown 起拖 + 双击复位（用户图二的顶部细条）");
ok(form.includes("const COMPOSER_EDITOR_MIN = 48;"),
  "下限 = 48px（与 .composer-editor 的 min-height 同口径 —— 拖不小）");
ok(/Math\.min\(Math\.round\(window\.innerHeight \* 0\.55\), 560\)/.test(form),
  "上限 = min(55vh, 560px)（半个窗多一点 —— 别把消息区挤没）");
ok(form.includes('window.addEventListener("pointermove", move)') && form.includes('window.addEventListener("pointerup", up)') && form.includes('window.addEventListener("pointercancel", up)'),
  "拖动走 **window 级监听**（指针离开把手仍收到；⛔ 不用 pointer capture —— 合成事件下 setPointerCapture 会直接抛）");
ok(form.includes('"--composer-editor-h"') && form.includes('"--composer-editor-max"'),
  "高度经 CSS 变量写到 form（--composer-editor-h / -max，避免给 ComposerEditor 加 prop 面）");
ok(/height: var\(--composer-editor-h, auto\)/.test(css) && /max-height: var\(--composer-editor-max, min\(42vh, 360px\)\)/.test(css),
  "样式消费变量，且**未拖动时保持原「内容自适应 + min(42vh,360px) 上限」行为**（不同拖动 = 不同默认）");
ok(form.includes('localStorage.setItem("composer-editor-height"') && form.includes('localStorage.getItem("composer-editor-height")') && form.includes('localStorage.removeItem("composer-editor-height")'),
  "持久化三件套：拖动落盘 / 启动读回（读回时也钳上限）/ 双击清除");
ok(/\.composer-resize-handle \{[\s\S]{0,240}?touch-action: none/.test(css),
  "把手 touch-action:none（不开会被滚动手势吃掉，真机拖不动）");
ok(/\.composer-resize-grip \{/.test(css) && /\.composer-resize-handle:hover \.composer-resize-grip/.test(css),
  "把手视觉：居中胶囊 + hover 提色（找得到把手）");

console.log(`\n【composer-resize】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
