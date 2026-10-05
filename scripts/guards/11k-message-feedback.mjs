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
ok((bar.match(/<FeedbackIconButton/g) ?? []).length === 2, "浮条两个动作都用共用按钮（与消息脚部同一套两段反馈）");
ok(/复制所选文字/.test(bar) && /添加到对话/.test(bar), "两个动作齐全：复制 / 添加到对话");
ok(/onCopy=\{messageHandlers\.onCopy\}/.test(read("src/features/app-view/AppView/02-main-stage/01-timeline.tsx"))
  && /onAppend=\{messageHandlers\.onQuote\}/.test(read("src/features/app-view/AppView/02-main-stage/01-timeline.tsx")),
  "挂在时间线里，且两个动作都复用现成通道（copyMessage / quoteMessage）⇒ 不另造第二份复制或引用实现");
ok(/host\.contains\(range\.commonAncestorContainer\)/.test(bar) && /host\.contains\(selection\.anchorNode\)/.test(bar),
  "选区两头都在时间线内才弹（跨到侧栏/输入框的选区不抢）");
ok(/closest\("input, textarea, \[contenteditable\]"\)/.test(bar), "输入框里的选区让给浏览器原生菜单");
ok(/addEventListener\("scroll", close, true\)/.test(bar) && /addEventListener\("resize", close\)/.test(bar),
  "一滚 / 一 resize 就收起（浮条按视口坐标定位，跟着滚必然错位）");
ok(/onPointerDown=\{close\}/.test(bar) && !/document\.addEventListener\("mouse(down|up)"/.test(bar),
  "收起靠透明垫层，不靠 document 上的 mousedown（那会在按钮响应之前就把浮条卸掉 = 点了没反应）");
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
const scrimZ = zOf(".selection-action-scrim {");
const barZ = zOf(".selection-action-bar {");
ok(scrimZ === 1000 && barZ === 1001, `层级带落在"轻浮层"这一档（实得 垫层 ${scrimZ} / 浮条 ${barZ}，须为 1000 / 1001）`);
ok(barZ > 400, "浮条必须高于全局模态 400（DESIGN.md 层级带；否则模态里选字看不见浮条）");

console.log(`\n【feedback】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
