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
ok(/const DONE_MS = 1100;/.test(button) && /window\.setTimeout\(\(\) => setDone\(false\), DONE_MS\)/.test(button),
  "第二段是定时回位，且时长取自常量（不是一堆魔法数）");
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
const doneRule = /\.message-footer button\[data-phase="done"\]\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
ok(doneRule.includes("animation:") && doneRule.includes("color: var(--accent)"), "第一段：done 态有弹动动画 + 主色");
ok(doneRule.includes("opacity: 1"), "done 态强制可见（点了 hover 项后鼠标移开，成功反馈不许被抹掉）");
ok(/@keyframes message-action-pop\s*\{[\s\S]*?\n\}/.test(styles), "关键帧存在（缩一下 → 过冲 → 回正）");
const reduceBlock = /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.message-footer button\[data-phase="done"\]\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
ok(reduceBlock.includes("animation: none") && !reduceBlock.includes("color"),
  "reduced-motion 只关弹动、**保留对勾与颜色**（反馈是信息，动效才是装饰）");
ok(!/\[data-phase="idle"\][^{]*\{[^}]*animation:/.test(styles), "负向：回 idle 时不重播动画（否则'变回去'会再弹一次）");

console.log(`\n【feedback】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
