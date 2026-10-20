/**
 * 输入框底栏「动态状态灯」判据（10-12 立）：权限胶囊右侧空位的浮动状态图标。
 *
 * 失效方式全是静默的：改成同时亮一排（挤掉权限胶囊/模型选择器）、轮换逻辑删了（只显示第一个
 * 状态，后面的永远看不到）、数据源改成组件内自己 fetch（每次渲染都打引擎）、响应式隐藏丢了
 * （窄窗挤压发送按钮）、container 化 .composer（给弹层造新包含块，quick-pop 翻转定位歪掉）。
 * 本守卫钉**代码形态**；行为由验收 `status-lights` 真跑。
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
  console.log(`  ${condition ? "✓" : "✗"} 【status-lights】${message}`);
  if (!condition) fails++;
};

const lights = codeOnly(read("src/features/status/ComposerStatusLights.tsx"));
const form = codeOnly(read("src/features/app-view/AppView/02-main-stage/03-composer/02-composer-form.tsx"));
const css = read("src/styles/04-cards-tools.css");
const rootCss = read("src/styles/01-base-and-chrome.css");
const timelineCss = read("src/styles/02-sidebar-threads.css");

/* ── 组件形态 ── */
ok(lights.includes("export function ComposerStatusLights") && lights.includes("icon: Target"),
  "组件在：🎯 目标模式有专属图标（用户点名的第一盏灯）");
ok(lights.includes("AlarmClock") && lights.includes("Clock3") && lights.includes("Bell") && lights.includes("Workflow") && lights.includes("Bot") && lights.includes("Users"),
  "六盏灯齐：目标 / 等待选择 / 挂起消息（定时走 AlarmClock）/ 配方 / 子智能体 / 专家团");
ok(lights.includes("lights[rot % lights.length]") && !/lights\.map\(/.test(lights) && (lights.match(/className="composer-status-light/g) ?? []).length === 1,
  "⛔ 最多亮一盏（用户令）：单节点渲染，没有 map 全量铺开");
ok(/setInterval\(\(\) => setRot\(\(current\) => current \+ 1\), 3000\)/.test(lights) && lights.includes("lights.length < 2"),
  "多盏并存时每 3 秒轮流展示；只有一盏时不挂定时器");
ok(lights.indexOf("useState(0)") < lights.indexOf("if (!lights.length) return null") && lights.indexOf("useEffect(") < lights.indexOf("if (!lights.length) return null"),
  "hooks 在早退之前调用（hook 调用序不随状态数变化）");
ok(!lights.includes("window.codex.request"),
  "⛔ 纯展示组件：数据全部来自 props（既有 bag 状态），不在渲染路径里打引擎");
ok(lights.includes('goalStatus === "complete"') && lights.includes('"ok"') && lights.includes('"danger"') && lights.includes('"muted"'),
  "目标灯色彩语义：完成=ok / 受阻=danger / 暂停=muted / 活动=accent 呼吸");

/* ── 接线 ── */
ok(form.includes("<ComposerStatusLights") && form.includes("goalText={goalText}") && form.includes("goalStatus={goalStatus}"),
  "接进 composer 底栏：目标两态直传");
ok(form.includes("agentAsk && (!thread || agentAsk.threadId === thread.id)"),
  "等待选择灯：只认**当前会话**的 agentAsk（别的会话的提问不在这亮）");
ok(form.includes("queuedCount={queue.length}") && form.includes("Object.values(queueTimers["),
  "挂起消息灯：queue + queueTimers 既有状态（不新开真相源）");
ok(form.indexOf('label="权限"') < form.indexOf("<ComposerStatusLights"),
  "位置 = 权限胶囊右侧（用户圈的那块空位）");

/* ── 样式与响应式 ── */
ok(/\.composer-status-light \{/.test(css) && /\.composer-status-lights \{/.test(css) && /\.tone-pending/.test(css) && /\.tone-danger/.test(css) && /\.tone-ok/.test(css) && /\.tone-muted/.test(css),
  "样式在：五档 tone 全有（accent 默认 + pending/danger/ok/muted）");
ok(/@keyframes status-light-pulse/.test(css) && /\.composer-status-light\.pulse/.test(css),
  "呼吸动画只给 pulse 灯（静态灯不闪）");
ok(/@media \(max-width: 1280px\)[\s\S]{0,200}?\.composer-status-light > i\.light-label \{ display: none; \}/.test(css)
  && /@media \(max-width: 1060px\)[\s\S]{0,200}?\.composer-status-lights \{ display: none; \}/.test(css),
  "窗口自适应两档：≤1280px 收文字只留图标、≤1060px 整块隐藏");
ok(!/\.composer\s*\{[^}]*container-type/.test(css) && !/\.composer-wrap\s*\{[^}]*container-type/.test(css),
  "⛔ 不给 .composer/.composer-wrap 开 container-type：那会给后代弹层造新包含块（quick-pop 翻转会歪）");

/* ── 会话主列自适应（10-20 用户：「全屏中间还是一样大」+「两边要留好刻度尺和专家团轨道」）──
   失效方式：只改 .timeline 不改 composer-wrap ⇒ 消息与输入框错位；两侧让位写死 23px ⇒
   正文压到左侧刻度尺/右侧办公室轨道下面（用户截图报障）。两处必须引用同一组变量。 */
ok(rootCss.includes("--chat-column-max: 1360px") && rootCss.includes("--chat-side-reserve: clamp(23px, 10%, 104px)"),
  "会话主列变量在：宽窗封顶 1360px + 两侧按 10% 让位（上限 104px = 右侧轨道 92 + 呼吸）");
ok(timelineCss.includes("max(var(--chat-side-reserve), calc((100% - var(--chat-column-max)) / 2))")
  && css.includes("min(var(--chat-column-max), calc(100% - var(--chat-side-reserve) * 2))"),
  "消息列与输入框同宽自适应：两边同一组变量（⛔ 单边改宽会让中间内容歪掉）");
ok(!timelineCss.includes("50% - 410px") && !css.includes("min(820px, 100% - 46px)"),
  "旧的 820px 死宽已拆除（窗口变大时正文能真正铺开）");

/* ── 输入框按自身宽度自适应（10-21 用户：右侧面板打开后输入框被挤扁，底栏/上方胶囊挤在一起）──
   失效方式：用 viewport 媒体查询（右栏开合不改 viewport ⇒ 永远不触发）、或只隐藏控件不做状态行换行。 */
ok(form.includes("composerFormRef") && form.includes("composer-micro") && form.includes("new ResizeObserver(read)") && form.includes("attachComposerForm"),
  "输入框观察自身宽度并分 composer-narrow / composer-micro 两档（不靠 viewport）");
ok(/\.composer:is\(\.composer-narrow, \.composer-micro\) \.composer-setting > span \{ display: none; \}/.test(css)
  && /\.composer-wrap:has\(\.composer-micro\) \.composer-status-row/.test(css)
  && /grid-template-columns: minmax\(0, 1fr\); row-gap: 4px;/.test(css),
  "窄宽度：权限/模型/强度只留图标，状态胶囊改上下两行（后台在上、文件/步骤在下）");

console.log(`\n【status-lights】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
