/**
 * /goal 目标条判据（10-06 夜五轮立；用户对照 Qoder 截图：「目标 时间 ，目标内容 尾部 编辑，删除，暂停」）。
 *
 * 失效方式全是静默的：暂停键点了没反应（走了一个引擎不存在的 RPC 名）、编辑改了文本却把暂停态
 * 弄丢、计时用本地挂载起点（切会话/重启就不准）、旧的小圆片/旧横幅悄悄复活。
 * 本守卫钉**代码形态与引擎口径**（口径来源 = 10-06 对随包引擎的隔离实测）；行为由验收 `goal-bar` 真跑。
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
  console.log(`  ${condition ? "✓" : "✗"} 【goal-bar】${message}`);
  if (!condition) fails++;
};

const bar = codeOnly(read("src/features/status/GoalBar.tsx"));
const composer = codeOnly(read("src/features/app-view/AppView/02-main-stage/03-composer.tsx"));
const form = codeOnly(read("src/features/app-view/AppView/02-main-stage/03-composer/02-composer-form.tsx"));
const css = read("src/styles/17-visual-cards.css");

ok(bar.includes("export function GoalBar") && bar.includes("<Target") && bar.includes("PenLine") && bar.includes("Trash2") && bar.includes("Pause") && bar.includes("Play"),
  "目标条：🎯 目标标题 + 内容 + 尾部 编辑/删除/暂停-继续 三键（Qoder 布局）");
ok(bar.includes('window.codex.request("thread/goal/get"') && bar.includes("timeUsedSeconds") && bar.includes('goalStatus !== "active"'),
  "计时 = **引擎侧** timeUsedSeconds（活动态才挂 1s tick、暂停/完成冻结；⛔ 不本地记开始时间）");
ok(bar.includes("meta.updatedAt > 0") && bar.includes("Math.floor(now / 1000) - meta.updatedAt"),
  "外推 = 引擎累积 + 离 lastUpdated 差值；⛔ updatedAt 缺失时不外推（按 epoch 加 = 读数变几十万小时）");
ok(composer.includes('status: nextPaused ? "paused" : "active"') && !/thread\/goal\/(pause|resume)/.test(composer),
  "暂停/继续走 thread/goal/set 的 status 字段（⛔ 引擎没有 goal/pause|resume 两个方法 —— 10-06 隔离引擎实测，别改回去）");
ok(composer.includes("if (nextPaused && activeThreadRunning) void interrupt();"),
  "暂停时正在跑的回合要 interrupt（引擎的 paused 只停「下一次自动续跑」）");
ok(composer.includes('openAppPrompt("编辑目标"') && composer.includes('goalStatus === "paused" ? "paused" : "active"'),
  "编辑目标：弹输入框 → set；⛔ 编辑不得把暂停态改回 active（保持原状态）");
ok(composer.includes("<GoalBar threadId={thread.id}") && composer.includes("onDelete={stopGoalLoop}"),
  "接进 composer（位置 = 输入框上方卡片栈；删除 = 既有 stopGoalLoop → thread/goal/clear）");
ok(!form.includes("chip-goal") && !/\.mode-chip-float\.chip-goal/.test(css) && !/\.mode-banner/.test(css),
  "⛔ 旧「目标小圆片 + mode-banner 横幅族」整族已撤（goal-loop 是它最后的消费方；plan 的 chip-plan 保留）");
ok(/\.goal-bar \{/.test(css) && /\.goal-bar-btn \{/.test(css) && /\.goal-bar-actions \{/.test(css) && /\.goal-bar\.paused \{/.test(css),
  "目标条样式在（软粉底 / 图标键 / 暂停态变灰）");
ok(/\.goal-bar \{[\s\S]{0,280}?width: 100%/.test(css),
  "整条与输入框同宽（width:100% 在 .goal-bar 里 —— 用户令「跟输入框一样长」）");

/* ── 时长格式化真值表（纯函数真跑；口径 = Qoder 的「3秒」） ── */
{
  const { formatGoalTime } = await import("../../src/lib/goal-time.mjs");
  ok(formatGoalTime(0) === "0秒" && formatGoalTime(3) === "3秒" && formatGoalTime(59) === "59秒",
    "真值：<60 秒 → 「N秒」（3 秒 → 3秒）");
  ok(formatGoalTime(60) === "1分0秒" && formatGoalTime(125) === "2分5秒",
    "真值：<60 分 → 「X分Y秒」");
  ok(formatGoalTime(3600) === "1小时0分" && formatGoalTime(7325) === "2小时2分",
    "真值：≥60 分 → 「X小时Y分」");
  ok(formatGoalTime(-5) === "0秒" && formatGoalTime(NaN) === "0秒" && formatGoalTime(undefined) === "0秒",
    "真值：负数/非数一律回落「0秒」（不抛不显示 NaN）");
}

console.log(`\n【goal-bar】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
