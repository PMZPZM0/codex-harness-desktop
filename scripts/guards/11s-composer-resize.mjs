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
/* 10-06 夜九轮（用户令：「放到输入框边框上，不要放里面，可以稍微长一点点」）：把手从框内
   内嵌细条改成**骑在顶边框上**的绝对定位胶囊；位置判据必须钉（改回内嵌 = 用户点名的形态没了）。 */
/* ⛔ 三条一律用 `[^}]*`（**规则体内部**匹配）而不是 `[\s\S]{0,N}`：窗口跨过右括号后会撞上
   旁边别的规则的同类属性 ⇒ 删掉本规则里的声明照样绿（M2 变异实测的假绿，当场收紧）。 */
ok(/\.composer-resize-handle \{[^}]*position: absolute[^}]*top: 0[^}]*left: 50%[^}]*translate\(-50%, -50%\)/.test(css),
  "把手**骑在输入框顶边框上**（absolute + 水平居中 + 纵向一半在框外）—— 用户「放到边框上，不要放里面」");
ok(/\n\.composer \{[^}]*position: relative/.test(css),
  ".composer 是定位锚（position: relative —— 少了它把手会锚到更外层祖先）");
ok(/\.composer-resize-grip \{[^}]*width: 56px/.test(css),
  "胶囊加长 40→56px（用户：「可以稍微长一点点，现在有点短」）");

/* ── 10-27 输入框胶囊弹层两条用户实测（同一块组件，一起钉）──
   ① 「这个权限选项弹窗展示紧凑一点，两边空白太多了」
   ② 「模型下拉框显示是在应用窄界面的时候，展示不全，出现滚轮」 */
{
  const popCss = read("src/styles/10-settings-providers.css");
  const menuSrc = read("src/features/composer/Composer.tsx");
  /* ① 空图标位 + 150px 下限 = 两侧白站（权限三条既无色点也无字母方块） */
  ok(/\.composer-menu-pop \{[^}]*min-width: 0;/.test(popCss) && !/\.composer-menu-pop \{[^}]*min-width: 150px;/.test(popCss),
    "权限菜单按内容收紧（min-width 150px 已删 —— 短菜单不再两侧各留 20px 空白）");
  ok(/const hasIcon = Boolean\(itemTone \|\| option\.monogram \|\| option\.value === "__model_settings__"\)/.test(menuSrc)
    && /\{hasIcon && <span className=\{`menu-item-icon/.test(menuSrc),
    "没有图标内容的行**不占 20px 图标槽**（权限那三条的左侧空白就是它）");
  /* ② 位置/高度自适应：挑空间大的一侧 + 按实测高度铺开（⛔ 不回退到写死 360px） */
  ok(/const \[popPlace, setPopPlace\] = useState<\{ side: "up" \| "down"; maxHeight: number \}>/.test(menuSrc)
    && /const side: "up" \| "down" = above >= below \? "up" : "down";/.test(menuSrc)
    && /addEventListener\("resize", measure\)/.test(menuSrc),
    "胶囊弹层按触发器上下**实测空间挑边**展开，并随窗口尺寸重算（窄界面不再被 360px 卡出滚轮）");
  ok(/\.\.\.\(popPlace\.side === "down" \? \{ top: "calc\(100% \+ 8px\)", bottom: "auto" \} : \{\}\)/.test(menuSrc),
    "向下展开时改用 top 定位（bottom:auto，两侧不同时生效）");
  ok(!/max-height: 360px;/.test(popCss),
    "⛔ 弹层不再写死 max-height:360px（那是「模型一多就出滚轮」的直接原因）");
}

console.log(`\n【composer-resize】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
