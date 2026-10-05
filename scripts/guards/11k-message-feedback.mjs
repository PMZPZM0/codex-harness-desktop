/**
 * 消息操作图标的「两段反馈」与摆放顺序判据（2026-10-05）
 *
 * 起因（用户原话）：「把用户消息下面的常驻复制靠右，然后所有的图标都要做两段动画，
 * 比如复制成功反馈，收藏，收藏成功两段，Codex 消息下面也是所有图标做两段反馈」。
 *
 * ⛔ 钉的是三件"改坏了不会报错、只会悄悄变难看"的事：
 *   ① 五个动作**必须都走同一个按钮组件** —— 散装写 `onClick` 的话，加一个新动作就少一份反馈；
 *   ② 用户消息里常驻复制**必须排在最后**（hover 项仍占位，谁在最后谁贴右端）；
 *   ③ 收藏那条 `onFire` 必须**直接返回** requestFavorite 的结果 —— 一旦有人把它写成块语句
 *      （`() => { requestFavorite(...) }`），返回值被吞成 undefined，"没接住"也会演成功，
 *      而 tsc 完全看不出来（返回类型是 `void | boolean`）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【feedback】${message}`);
  if (!condition) fails++;
};

/* ───────────────────────── 一、共用按钮组件 ───────────────────────── */

const buttonPath = "src/features/shared/FeedbackIconButton.tsx";
ok(existsSync(join(ROOT, buttonPath)), "共用按钮组件存在（反馈只有一份实现）");
const button = codeOnly(read(buttonPath));
ok(/data-phase=\{done \? "done" : "idle"\}/.test(button), "两段状态用 data-phase 暴露给 CSS（视觉归样式、时序归组件）");
ok(/export const ACTION_FEEDBACK_MS = 1100;/.test(button) && /const DONE_MS = ACTION_FEEDBACK_MS;/.test(button)
  && /window\.setTimeout\(\(\) => setDone\(false\), DONE_MS\)/.test(button),
  "第二段是定时回位，窗口只有一个定义（导出给外层浮层共用，⛔ 别在别处再写一个毫秒数）");
ok(/useEffect\(\(\) => \(\) => window\.clearTimeout\(timer\.current\), \[\]\)/.test(button),
  "卸载时清掉定时器（消息行会随虚拟列表反复挂卸，不清就是给已卸载组件 setState）");
ok(/if \(onFire\(\) === false\) return;/.test(button), "onFire 明确返回 false 时不演成功（收藏没人接住的那条路）");
ok(/clearTimeout\(timer\.current\)/.test(button.split("const fire")[1] ?? ""),
  "连点会重置计时（不是第一次的定时器把第二次的成功态提前抹掉）");

/* ───────────────────────── 二、消息脚部：全走同一个按钮 ───────────────────────── */

const footer = codeOnly(read("src/features/shared/MessageFooter.tsx"));
const uses = (footer.match(/<FeedbackIconButton/g) ?? []).length;
ok(uses === 5, `引用 / 编辑 / 复制 / 收藏 / 分支 五个动作都走共用按钮（实得 ${uses} 处）`);
ok(!/<button\b/.test(footer), "脚部不再自己写散装 <button>（散装 = 加一个新动作就少一份反馈）");
ok(/!isAgent \? <>\{quoteButton\}\{editButton\}\{favoriteButton\}\{copyButton\}</.test(footer),
  "用户消息：常驻复制排在**最后** ⇒ 贴着右端（10-05 用户点名）");
ok(/<>\{copyButton\}\{forkButton\}\{timeNode\}/.test(footer), "agent 消息：复制 → 分支 → 时间的原顺序不动");
ok(/onFire=\{\(\) => requestFavorite\(/.test(footer),
  "收藏的 onFire 直接返回 requestFavorite 的结果（写成块语句就会把 false 吞成 undefined）");
ok(/doneIcon=\{<Star size=\{12\} fill="currentColor" \/>\}/.test(footer), "收藏成功态是**实心星**（不是换成对勾，语义更准）");
ok(/label="分支"/.test(footer), "分支按钮保留文字标签（只有图标会丢掉它原有的可读性）");
ok(/doneIcon=\{<Check size=\{12\} \/>\}/.test(footer), "复制/引用/编辑/分支的成功态统一用对勾");

/* ───────────────────────── 三、CSS：两段动画 ───────────────────────── */

const styles = read("src/styles/03-messages-turns.css");
const doneRule = /\.message-footer button\[data-phase="done"\][^{]*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
ok(doneRule.includes("animation:") && doneRule.includes("color: var(--accent)"), "第一段：done 态有弹动动画 + 主色");
ok(doneRule.includes("opacity: 1"), "done 态强制可见（点了 hover 项后鼠标移开，成功反馈不许被抹掉）");
ok(/\.selection-action-bar button\[data-phase="done"\]/.test(styles), "选区浮条的按钮也吃同一条 done 规则（反馈只有一份样式）");
ok(/@keyframes message-action-pop\s*\{[\s\S]*?\n\}/.test(styles), "关键帧存在（缩一下 → 过冲 → 回正）");
const reduceBlock = /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.message-footer button\[data-phase="done"\][^{]*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
ok(reduceBlock.includes("animation: none") && !reduceBlock.includes("color"),
  "reduced-motion 只关弹动、**保留对勾与颜色**（反馈是信息，动效才是装饰）");
ok(!/\[data-phase="idle"\][^{]*\{[^}]*animation:/.test(styles), "负向：回 idle 时不重播动画（否则'变回去'会再弹一次）");

/* ───────────────────────── 四、选区浮条（复制 / 添加到对话） ───────────────────────── */

const barPath = "src/features/shared/SelectionActionBar.tsx";
ok(existsSync(join(ROOT, barPath)), "选区浮条组件存在");
const bar = codeOnly(read(barPath));
ok((bar.match(/<FeedbackIconButton/g) ?? []).length === 3, "浮条三枚按钮都用共用按钮（选整条 / 复制 / 添加到对话）");
ok(/选整条消息/.test(bar) && /复制所选文字/.test(bar) && /添加到对话/.test(bar), "浮条三个动作齐全");
ok(/function wholeMessageRange/.test(bar) && /closest\("\.message"\)/.test(bar),
  "「选整条」是从选区往上找那条 .message，不是猜一个父节点");
ok(/closest\("button, \.message-footer, \.user-message-footer/.test(bar),
  "⛔ 扩到整条时必须排除操作条与按钮 —— agent 的 MessageFooter 就渲染在 .message-body 里面，整块 selectNodeContents 会把「复制 / 分支 / 15:16」一起选进去");
ok(/if \(!range\) return false;/.test(bar), "选区不在任何一条消息里 ⇒ 「选整条」不演成功");
ok(/selection\?\.addRange\(range\);\s*\n\s*measure\(\);/.test(bar),
  "扩完选区立刻重新定位浮条（等浏览器下一次 selectionchange 会慢半拍）");
ok(/onCopy=\{messageHandlers\.onCopy\}/.test(read("src/features/app-view/AppView/02-main-stage/01-timeline.tsx"))
  && /onAppend=\{messageHandlers\.onQuote\}/.test(read("src/features/app-view/AppView/02-main-stage/01-timeline.tsx")),
  "挂在时间线里，且两个动作都复用现成通道（copyMessage / quoteMessage）⇒ 不另造第二份复制或引用实现");
ok(/const hostBox = host\.getBoundingClientRect\(\);/.test(bar)
  && /box\.left < hostBox\.left - 1 \|\| box\.right > hostBox\.right \+ 1/.test(bar)
  && /startElement\?\.isConnected && endElement\?\.isConnected && \(!host\.contains\(startElement\) \|\| !host\.contains\(endElement\)\)/.test(bar),
  "「在不在时间线内」= 选区矩形**套在**时间线矩形里 + 两头节点还连着文档时补一道 contains：10-05 实测真拖选松手后消息区会重渲染，选区节点随即脱离文档，只看 contains 就永远不弹");
ok(!/commonAncestorContainer/.test(bar),
  "⛔ 不用 commonAncestorContainer —— 跨段选择时那个公共祖先可能是时间线的上层元素，contains 为 false 就会莫名不弹");
ok(/closest\("input, textarea, \[contenteditable\]"\)/.test(bar), "输入框里的选区让给浏览器原生菜单");
/* ↓ 10-05 用户实测「按键在那么远，而且两个按键都是假的，点不了」逼出来的三条硬约束 */
ok(/createPortal\([\s\S]*document\.body\s*\)/.test(bar),
  "⛔ 浮条必须 portal 到 body：挂在时间线里时，主舞台上有 transform 的祖先会改掉 position:fixed 的包含块 ⇒ 跑位 + 点不动（portal 到 body 是本仓轻浮层的做法）");
ok(/range\.getClientRects\(\)/.test(bar) && /rects\[rects\.length - 1\]/.test(bar),
  "定位取**最后一个** client rect（拖拽结束那一行），不用整个选区的 union rect —— 跨段选区的 union 上沿常在视口外，浮条就会离得很远");
ok(/window\.addEventListener\("scroll", scheduleMeasure, true\)/.test(bar),
  "滚动 = 重新贴着选区（不是收起），且绑在 window 捕获阶段：绑某个具体节点会被 React 换掉而静默失效");
ok(/above \? box\.top - GAP : box\.bottom \+ GAP/.test(bar), "上方放不下就翻到下面（锚点自己算，translate 只管对齐）");
ok(/event\.key === "Escape"/.test(bar), "ESC 能收起浮条");
/* ↓ 治「拖动时一直闪全选」+「松手不弹」的三条 */
ok(/const DRAG_SETTLE_MS = 220;/.test(bar) && /window\.setTimeout\(measure, DRAG_SETTLE_MS\)/.test(bar)
  && /document\.addEventListener\("selectionchange", scheduleMeasure\)/.test(bar),
  "选区停止变化 220ms 才弹：一路拖就一路重置计时 ⇒ 过程中一次都不渲染（10-05 用户：「拖动的时候一直闪全选内容」）");
ok(!/draggingRef/.test(bar),
  "⛔ 不许拿「是否按住鼠标」当闸门：10-05 实测 CDP 的 mousePressed 在本机不产生 pointerdown，标记会永远停在 true ⇒ 松手也不弹");
ok(/window\.addEventListener\("pointerup", scheduleMeasure, true\)/.test(bar),
  "松手再补一次（鼠标在选区外抬起时 selectionchange 不会再来）");
ok(/if \(bar && event\.target instanceof Node && bar\.contains\(event\.target\)\) return;/.test(bar),
  "全局 pointerdown 必须放过浮条内部的按下 —— 否则一按按钮就先收浮条，按钮永远点不动");
ok(!/selection-action-scrim/.test(bar) && !/\.selection-action-scrim/.test(styles),
  "负向：不许有全屏透明遮罩（它会抢走拖选时的命中目标 ⇒ 选区被反复重置 = 一直闪）");
ok(!/document\.addEventListener\("mouse(down|up)"/.test(bar), "不用 document 上的 mousedown 收起（会赶在按钮响应前卸掉浮条）");
/* 这是本轮最容易写错的一处：动作一触发就 setPlacement(null)，反馈挂在即将卸载的按钮上 ⇒ 没人看得见。 */
ok(/if \(Date\.now\(\) < holdUntilRef\.current\) return;/.test(bar),
  "触发动作后 hold 住这段时间：选区被浏览器清掉 / 输入框抢焦点都不许提前收浮条");
ok(/holdUntilRef\.current = Date\.now\(\) \+ ACTION_FEEDBACK_MS/.test(bar)
  && /window\.setTimeout\(\(\) => \{[\s\S]{0,160}setPlacement\(null\)/.test(bar),
  "延后到反馈播完才收浮条（时长取自共用常量，不是另写一个数）");
ok(/import \{ ACTION_FEEDBACK_MS, FeedbackIconButton \} from "\.\/FeedbackIconButton"/.test(bar),
  "成功窗口只有一处定义（两处各写一个毫秒数就会出现'按钮还在演、外层先收'）");
ok(/useEffect\(\(\) => \(\) => window\.clearTimeout\(holdTimer\.current\), \[\]\)/.test(bar),
  "延后收起的定时器在卸载时清掉");

const zOf = (selector) => Number(/z-index:\s*(-?\d+)/.exec(styles.slice(styles.indexOf(selector) + selector.length).slice(0, 300))?.[1] ?? NaN);
const barZ = zOf(".selection-action-bar {");
ok(barZ === 1001, `浮条在"轻浮层"这一档（实得 ${barZ}，须为 1001，与 .app-select-list 同档）`);
ok(barZ > 400, "浮条必须高于全局模态 400（DESIGN.md 层级带；否则模态里选字看不见浮条）");

console.log(`\n【feedback】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
