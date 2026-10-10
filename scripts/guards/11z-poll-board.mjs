/**
 * 守卫组 11z-poll-board —— 轮询板块（10-09 立）。
 *
 * 需求原文四条：① 独立渲染的轮询卡（状态 / 次数 / 间隔 / 耗时 / 进度，默认单行、点开看每轮）；
 * ② 可配间隔与超时上限 + 失败自动重试 + 明确的错误与超时提示 + 手动中止 + 结束后照常输出最终结果；
 * ③ 输入框左上角的后台任务胶囊（无任务隐藏、面板与输入框同宽、最多 3 条超出滚动、单条查看与中止）；
 * ④ 视觉与对话流/thinking 一致，且**通过新增独立渲染分支实现、不改动现有消息渲染逻辑**。
 *
 * 失效方式全是静默的（这类功能最典型的死法）：
 *   · 状态机不闭环 ⇒ 卡永远停在「轮询中」，用户等不到结论；
 *   · 迟到的 round 把已结束的任务复活 ⇒ 刚看到的「成功」自己变回「轮询中」；
 *   · 卡挂不进对话流（turnId 拿不到）⇒ 只有胶囊有数字、流里一张卡都没有；
 *   · 为了省事塞进 thinking 分支 ⇒ 需求明令禁止，且两者语义完全不同。
 *
 * ⛔ 本守卫要**真跑**状态机（含 5 秒的超时看门狗实测）⇒ 在 package.json 里用
 *    `node --experimental-strip-types scripts/guards/11z-poll-board.mjs` 跑（与 11n 同款）。
 *    独立守卫（不进 check-preflight 的 checks 计数）。
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
  console.log(`  ${condition ? "✓" : "✗"} 【poll-board】${message}`);
  if (!condition) fails++;
};

console.log("\n【poll-board】轮询板块（独立卡 / 状态机 / 后台任务胶囊）");

/* ── ① 纯函数真值表（真跑 src/lib/poll-config.mjs）──────────────────────────── */
const cfg = await import("../../src/lib/poll-config.mjs");
{
  const d = cfg.POLL_DEFAULTS;
  ok(d.intervalMs === 5000 && d.timeoutMs === 600000 && d.maxRetry === 3,
    `真值：默认 ${d.intervalMs}ms 间隔 / ${d.timeoutMs}ms 超时 / ${d.maxRetry} 次重试`);
  const tiny = cfg.normalizePollConfig({ intervalMs: 1, timeoutMs: 1, maxRetry: -5 });
  ok(tiny.intervalMs === 500 && tiny.maxRetry === 0 && tiny.timeoutMs >= tiny.intervalMs * 2,
    `真值：非法输入被钳到边界，且**超时 ≥ 间隔×2**（${tiny.timeoutMs} ≥ ${tiny.intervalMs * 2}）—— 否则第一轮还没发出就被判超时`);
  const huge = cfg.normalizePollConfig({ intervalMs: 999999, timeoutMs: 99999999, maxRetry: 99 });
  ok(huge.intervalMs === 120000 && huge.timeoutMs === 3600000 && huge.maxRetry === 10,
    "真值：上界也钳住（120 秒 / 1 小时 / 10 次）—— 别让「每 0 秒查一次」把厂商接口打挂");
  ok(cfg.backoffMs(5000, 0) === 5000 && cfg.backoffMs(5000, 1) === 10000 && cfg.backoffMs(5000, 3) === 40000,
    "真值：失败退避 = 间隔 × 2^连续失败次数（0/1/3 次 → 5s/10s/40s）");
  ok(cfg.backoffMs(5000, 30) === cfg.POLL_LIMITS.intervalMs.max,
    `真值：退避封顶在 ${cfg.POLL_LIMITS.intervalMs.max}ms —— 不封顶会退到几十分钟，等于放弃`);
  ok(cfg.pollStatusLabel("polling") === "轮询中" && cfg.pollStatusLabel("success") === "成功"
    && cfg.pollStatusLabel("failed") === "失败" && cfg.pollStatusLabel("timeout") === "超时" && cfg.pollStatusLabel("aborted") === "已中止",
    "真值：五态中文齐全（轮询中 / 成功 / 失败 / 超时 / 已中止）");
  ok(cfg.formatPollDuration(400) === "不到 1 秒" && /12\.4 秒/.test(cfg.formatPollDuration(12400)) && /3 分 07 秒/.test(cfg.formatPollDuration(187000)),
    "真值：耗时文案（不到 1 秒 / 12.4 秒 / 3 分 07 秒）—— 刚开的卡不能显示「0 秒」（像卡住了）");
  const measured = cfg.pollMetricText({ status: "polling", rounds: [{ at: 1000 }, { at: 4000 }, { at: 9000 }], intervalMs: 5000, managed: false, startedAt: 1000 }, 9000);
  const planned = cfg.pollMetricText({ status: "polling", rounds: [{ at: 1000 }], intervalMs: 5000, managed: true, startedAt: 1000 }, 9000);
  ok(/已轮询 3 次/.test(measured) && /每 4 秒/.test(measured) && /已耗时 8\.0 秒/.test(measured),
    `真值：非托管轮询**报实测间隔**（${measured}）—— 模型自己循环查时写死配置值就是在撒谎`);
  ok(/已轮询 1 次/.test(planned) && /每 5 秒/.test(planned),
    `真值：托管轮询**报配置间隔**（${planned}）`);
  ok(cfg.roundSummaryText({ ok: false, error: "429 too many requests" }) === "429 too many requests",
    "真值：每轮记录 = 结果或**错误**摘要（失败轮要看得见原因）");
}

/* ── ② 状态机闭环（真跑 src/polling/poll-store.ts）────────────────────────────
   ⛔ 这是本板块最容易糊的地方，所以逐条真跑：
      polling →（成功 / 失败 / 超时 / 中止）四路都要能到，且**终态不可逆变回**。 */
globalThis.window = globalThis.window ?? { setInterval: (...a) => setInterval(...a), clearInterval: (id) => clearInterval(id) };
globalThis.localStorage = globalThis.localStorage ?? { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
const store = await import("../../src/polling/poll-store.ts");
{
  const off = store.subscribePollStore(() => undefined);   // 看门狗只在有订阅者时挂定时器
  const id = "job-guard-1";
  store.openPollTask({ id, threadId: "th-1", turnId: "tu-1", title: "视频生成 · 可灵", managed: true });
  ok(store.getPollTask(id)?.status === "polling", "开任务 ⇒ 落在 polling（唯一的非终态）");
  store.pushPollRound(id, { ok: true, summary: "生成中", progress: "生成中" });
  store.pushPollRound(id, { ok: true, summary: "生成中" });
  ok(store.getPollTask(id)?.rounds.length === 2 && store.getPollTask(id)?.retries === 0,
    "每轮查询记账（轮次 +1，成功轮把连续失败计数清零）");
  store.pushPollRound(id, { ok: false, error: "网络抖动" });
  ok(store.getPollTask(id)?.rounds[2]?.ok === false && store.getPollTask(id)?.error === "网络抖动",
    "失败轮单独记录并且卡上带出原因（错误与超时提示的来源）");
  store.settlePollTask(id, { status: "success", result: "/workspace/a.mp4" });
  const done = store.getPollTask(id);
  ok(done?.status === "success" && done?.result === "/workspace/a.mp4" && Boolean(done?.endedAt),
    "轮询中 → 成功（带最终产物路径）");
  // ⛔ 迟到的 round 不许复活：主进程超时判掉那一刻，还在飞的那一轮没有意义
  store.pushPollRound(id, { ok: true, summary: "迟到的成功" });
  ok(store.getPollTask(id)?.status === "success" && store.getPollTask(id)?.rounds.length === 3,
    "⛔ 终态后迟到的 round **不复活**任务（否则面板永远停不下来 / 「成功」自己变回「轮询中」）");
  store.settlePollTask(id, { status: "failed", error: "后到的失败" });
  ok(store.getPollTask(id)?.status === "success" && store.getPollTask(id)?.result === "/workspace/a.mp4",
    "⛔ 终态**先到先得**：后来的 settle 不覆盖已经给出的结论");
  ok(store.pollTasksOfTurn("tu-1").length === 1 && store.pollTasksOfTurn("tu-2").length === 0,
    "卡按 turnId 精确归属（不会挂到别的回合、也不会每一回合都渲染一遍）");
  // 中止：用户动作是 aborted 的唯一来源
  const id2 = "job-guard-2";
  store.openPollTask({ id: id2, threadId: "th-1", turnId: "tu-1" });
  store.abortPollTask(id2);
  ok(store.getPollTask(id2)?.status === "aborted" && store.runningPollTasksOfThread("th-1").length === 0,
    "轮询中 → 已中止（用户按停；之后不再计入「运行中」）");
  /* 超时看门狗：真等 5 秒（POLL_LIMITS.timeoutMs.min = 5000，钳制不允许更短）。
     ⛔ 这条值得等 —— 只靠主进程判超时的话，模型自己循环调用（不带 wait）时没人判，
        卡会永远挂在「轮询中」。 */
  const id3 = "job-guard-3";
  /* ⛔ 间隔给到下界 500ms：超时会被兜成「≥ 间隔×2」，用默认 5 秒间隔的话这里会变成 10 秒
     （那条兜底是对的 —— 超时短于两轮间隔时，第一轮还没发出就被判超时）。 */
  store.openPollTask({ id: id3, threadId: "th-1", turnId: "tu-1", intervalMs: cfg.POLL_LIMITS.intervalMs.min, timeoutMs: cfg.POLL_LIMITS.timeoutMs.min });
  ok(store.getPollTask(id3)?.timeoutMs === 5000, `超时上限按配置走（本例 5 秒；实测 ${store.getPollTask(id3)?.timeoutMs}）`);
  await new Promise((r) => setTimeout(r, cfg.POLL_LIMITS.timeoutMs.min + 400));
  const timedOut = store.getPollTask(id3);
  ok(timedOut?.status === "timeout" && /超时上限|仍无结果/.test(String(timedOut?.error ?? "")),
    `轮询中 → 超时（看门狗实测 5 秒后自动收尾，并给明确提示：「${String(timedOut?.error ?? "")}」）`);
  // 补挂回合：主进程广播时只有 threadId，turnId 由渲染层补 —— 少了这张卡就永远不显示
  const id4 = "job-guard-4";
  store.openPollTask({ id: id4, threadId: "th-1" });
  ok(store.pollTasksOfTurn("tu-9").length === 0, "还没归属回合的任务不会凭空挂到别的回合上");
  store.backfillPollTurn("th-1", "tu-9");
  ok(store.pollTasksOfTurn("tu-9").length === 1, "backfillPollTurn 把「本会话里无归属的任务」补挂到当前回合（否则卡永远不显示）");
  off();
  if (fails) { /* 下面还要跑形态断言，不提前退出 */ }
  void fails;
}

/* ── ③ 渲染分支：**新增**，且没动既有消息渲染逻辑 ───────────────────────────── */
const turnView = codeOnly(read("src/features/session-turn/SessionTurn/03-turn-view.tsx"));
const itemView = codeOnly(read("src/features/session-queue/ItemView.tsx"));
const sessionQueue = codeOnly(read("src/features/session-queue/SessionQueue.tsx"));
const reasoning = codeOnly(read("src/features/shared/ReasoningCard.tsx"));
ok(/<PollTaskBoard turnId=\{turn\.id\} \/>/.test(turnView),
  "轮询卡挂在回合内（`.codex-turn` 里、既有 turn.after-content 插槽旁）—— 一个新增的兄弟节点");
ok(/<Slot id="turn\.after-content"/.test(turnView) && turnView.indexOf("<Slot id=\"turn.after-content\"") < turnView.indexOf("<PollTaskBoard"),
  "⛔ 既有那条插槽**原样保留**（新增节点排在它后面，没被替换掉）");
ok(!/poll/i.test(itemView) && !/poll/i.test(sessionQueue) && !/poll/i.test(reasoning),
  "⛔ 既有消息渲染逻辑一个字没动（ItemView / SessionQueue / ReasoningCard 里零 poll 字样 —— 独立分支，不是往里塞）");

const board = codeOnly(read("src/features/polling/PollTaskBoard.tsx"));
ok(/if \(!mine\.length\) return null/.test(board) && /task\.turnId === turnId/.test(board),
  "没有轮询任务时整块不渲染（连 DOM 都不产生）；有则按回合精确匹配");

/* ── ④ 卡片字段与交互 ─────────────────────────────────────────────────────── */
const card = codeOnly(read("src/features/polling/PollCard.tsx"));
ok(/pollStatusLabel\(task\.status\)/.test(card) && /pollMetricText\(task, now\)/.test(card),
  "卡头 = 状态 + 「已轮询 N 次 · 每 X · 已耗时 Y」（需求 1 的四项指标）");
ok(/task\.progress && <span className="poll-progress"/.test(card),
  "卡头带**当前任务进度**（查出来是什么就显示什么，不猜）");
ok(/const \{ open, toggle \} = useCardOpen\(polling\)/.test(card),
  "默认紧凑单行、运行中自动展开、结束即收起（与 thinking 卡同一套折叠语义，用户点过以用户为准）");
ok(/<ChevronDown size=\{13\} className="poll-caret"/.test(card) && /aria-expanded=\{open\}/.test(card),
  "点击展开/收起（chevron 指示 + aria-expanded）");
ok(/task\.rounds\.slice\(\)\.reverse\(\)/.test(card) && /formatPollClock\(round\.at\)/.test(card) && /roundSummaryText\(round\)/.test(card),
  "展开体 = 每轮记录（时刻 / 第几轮 / 结果或错误摘要），最近一轮在最上面");
ok(/polling && \(/.test(card) && /className="poll-stop"/.test(card) && /中止/.test(card),
  "中止按钮**只在轮询中**出现（终态给一个没有意义的按钮就是假功能）");
ok(/abortPollTask\(task\.id\)/.test(card) && /window\.codex\.pollAbort\(\{ taskId: task\.id \}\)/.test(card),
  "中止：本地立刻收尾 + 通知主进程停下 wait 循环（两个进程都要停，缺一边就是「界面停了后台还在转」）");
ok(/失败：/.test(card) && /超时/.test(card) && /你中止了这次轮询/.test(card),
  "失败 / 超时 / 已中止各有**明确提示**（超时那条还要说清「任务可能还在跑、之后可再查」）");
ok(/setNow\(Date\.now\(\)\)/.test(card) && /if \(!polling\) return;/.test(card),
  "已耗时只在轮询中每秒刷新（历史会话几十张结束态的卡不挂定时器）");

/* ── ⑤ 后台任务胶囊 ───────────────────────────────────────────────────────── */
const capsule = codeOnly(read("src/features/polling/BackgroundTaskCapsule.tsx"));
const composer = codeOnly(read("src/features/app-view/AppView/02-main-stage/03-composer.tsx"));
ok(/个后台任务运行中/.test(capsule) && /if \(!running\.length\) return null/.test(capsule),
  "「N 个后台任务运行中」+ **无任务时隐藏**（平时 DOM 里什么都没有）");
ok(/task\.status === "polling"/.test(capsule), "只数**还在跑**的任务（已结束的不占这个数）");
ok(/VISIBLE_ROWS = 3/.test(capsule) && /maxHeight: `\$\{VISIBLE_ROWS \* 34\}px`/.test(capsule) && /overflow-y: auto/.test(read("src/styles/32-polling.css")),
  "面板最多展示 3 条、超出滚动（容器高度按 3 行写死 + 内部滚动）");
ok(/task\.kind === "tool" \? `turn-\$\{task\.turnId\}` : `poll-\$\{task\.id\}`/.test(capsule)
  && /scrollIntoView/.test(capsule),
  "单条「查看」= 滚到它在对话里的位置（轮询→轮询卡 / 长命令→它所在的回合；同一件事不在两个地方看，不开弹窗）");
ok(/onClick=\{\(\) => stopOne\(task\)\}/.test(capsule) && /abortPollTask\(task\.id\)/.test(capsule),
  "单条「中止」= 只停这一条（不是全部）");
ok(/if \(task\.kind === "tool"\) \{ requestToolAbort\(task\.id\); return; \}/.test(capsule)
  && /window\.codex\.pollAbort\(\{ taskId: task\.id \}\)/.test(capsule),
  "中止分两条路：长命令 → **打断当前回合**（命令是引擎在跑）；轮询 → 主进程 poll:abort（停掉那个等待循环）");
ok(/window\.codex\.pollConfigSave\(next\)/.test(capsule) && /setPollConfig\(patch\)/.test(capsule) && /applyConfig/.test(capsule),
  "间隔 / 超时 / 重试次数可配，且**两边都写**（本地立刻生效 + 主进程下一轮用新值）");
ok(/\{thread && <BackgroundTaskCapsule threadId=\{thread\.id\} \/>\}/.test(composer)
  && composer.indexOf("<BackgroundTaskCapsule") < composer.indexOf("<ComposerComposerForm")
  && composer.indexOf("<BackgroundTaskCapsule") > composer.indexOf("<VoiceAnnounceIndicator"),
  "⛔ 位置 = 卡片栈**最下面一行**（紧挨输入框上沿、在两个 fixed 浮层之后）—— 从上到下依次排列，不互相遮；\n"
  + "⛔ 必须包在 `{thread && …}` 里 —— 欢迎页（无会话）绝不渲染，否则别的会话的后台任务串进来（10-10 用户截图）");

/* ── ⑤b 长命令 / 长工具调用也算后台任务（10-09 用户追加）──────────────────────
   「其它异步/长任务也要能看到并中止」——视频那条只是真轮询，日常长命令同样要有出口。
   ⛔ 这条最容易糊的地方：**别把每个工具调用都塞进胶囊**（`read`/`ls` 几十毫秒也弹一个转圈），
      所以必须有阈值，且提升动作放在看门狗（只有周期 tick 才知道"这一刻还在跑"）。 */
const storeSrc = read("src/polling/poll-store.ts");
ok(/export const SLOW_TOOL_MS = \d+/.test(storeSrc)
  && /export function beginToolWatch\(/.test(storeSrc) && /export function endToolWatch\(/.test(storeSrc)
  && /export function endToolWatchesOfTurn\(/.test(storeSrc),
  "长命令追踪三件套（beginToolWatch / endToolWatch / endToolWatchesOfTurn）+ 阈值常量");
ok(/kind: input\?\.kind === "tool" \? "tool" : "poll"/.test(storeSrc) && /const toolTaskId = \(itemId: string\) => `tool:\$\{itemId\}`/.test(storeSrc),
  "长命令任务的 kind=\"tool\" 且 id 走 `tool:` 命名空间（与视频 jobId 分开，两套 id 都来自主进程会撞）");
ok(/task\.kind === "poll" && task\.turnId === id/.test(storeSrc),
  "对话流里只渲染 `kind:\"poll\"` 的卡（长命令在流里已有自己的工具卡，再画一张 = 同一件事两处看）");
ok(/task\.status !== "polling" \|\| task\.kind !== "poll"\) return task;/.test(storeSrc),
  "⛔ 轮询超时**不作用于**长命令（长命令跑多久是它自己的事，别拿轮询超时上限把它掐了）");
ok(/watchingTools\.size > 0/.test(storeSrc),
  "看门狗在「还有工具项在跑」时也要活着（否则长命令永远等不到提升那一刻）");
ok(/export function setToolAbortHandler\(/.test(read("src/polling/poll-store.ts")) && /requestToolAbort/.test(read("src/polling/poll-store.ts")),
  "长命令的「中止」出口：模块级 store 拿不到 bag.interrupt ⇒ 与 announce-bus 同款的回调注册范式");

/* ── ⑥ 样式与层级 ─────────────────────────────────────────────────────────── */
const stylesEntry = read("src/styles.css");
const css = read("src/styles/32-polling.css");
ok(/@import "\.\/styles\/32-polling";/.test(stylesEntry), "样式入口引入了 32-polling.css（漏了就是全裸无样式）");
ok(/\.poll-card \{[\s\S]{0,240}?font-size: 12\.5px/.test(css) && /\.poll-card \{[\s\S]{0,240}?background: transparent/.test(css),
  "卡与 `.action-card` 同形态（12.5px / 无底色无边框）—— 与对话流、thinking 板块同一套语言");
ok(/@keyframes poll-appear[\s\S]{0,160}?0\.18s|animation: poll-appear 0\.18s ease-out both/.test(css) && /prefers-reduced-motion[\s\S]{0,240}?\.poll-body/.test(css),
  "展开动效与 `msg-appear`/`text-fade-in` 同档（0.18s ease-out），且尊重 prefers-reduced-motion");
ok(/\.poll-bg-panel \{[\s\S]{0,400}?left: 0;[\s\S]{0,60}?right: 0;/.test(css) && /\.poll-bg-wrap \{[\s\S]{0,160}?position: relative/.test(css),
  "面板 left/right = 0（相对 `.composer-wrap`）⇒ 宽度恒等于输入框（⛔ 写视口坐标会随窗口变歪）");
ok(/\.poll-bg-panel \{[\s\S]{0,400}?z-index: 10000/.test(css),
  "面板层级在 DESIGN.md 的 composer 浮层带（10000~12000，与 .edited-files-pop 同档）");
ok(/\.poll-t-running \{ color: var\(--orange\)/.test(css) && /\.poll-t-ok \{ color: var\(--green\)/.test(css) && /\.poll-t-err \{ color: var\(--red\)/.test(css) && /\.poll-t-mute \{ color: var\(--faint\)/.test(css),
  "状态色全走主题变量（橙=进行中 / 绿=成功 / 红=失败 / 灰=已中止）—— 深色主题不会变黑底黑字");

/* ── ⑦ 主进程：真接线（能力网关 + 3 条通道 + 域登记）────────────────────────── */
const rpc = codeOnly(read("electron/features/dispatch-rpc.ts"));
const registry = read("electron/ipc-registry.ts");
const manifest = JSON.parse(read("electron/ipc-channels.manifest.json"));
const composition = JSON.parse(read("electron/composition.json"));
const core = codeOnly(read("electron/features/dispatch-core.ts"));
ok(/type: "poll",\s*\n\s*action: "start"/.test(rpc) || /action: "start",[\s\S]{0,120}?type: "poll"/.test(rpc) || /type: "poll"/.test(rpc),
  "能力网关会广播 poll 事件（提交任务即开卡，用户立刻看得见「有个异步任务在跑」）");
ok(/emit\(\{ action: "round"/.test(rpc) && /emit\(\{ action: "end", status: "success"/.test(rpc)
  && /emit\(\{ action: "end", status: "failed"/.test(rpc) && /emit\(\{ action: "end", status: "timeout"/.test(rpc)
  && /emit\(\{ action: "end", status: "aborted"/.test(rpc),
  "四路终态都广播 end（成功 / 失败 / 超时 / 已中止）—— 少一路卡上就没有结论");
ok(/failures > local\.maxRetry/.test(rpc) && /backoffMs\(local\.intervalMs, failures\)/.test(rpc) && /failures = 0/.test(rpc),
  "查询失败**自动重试**（指数退避，超过上限才判失败；成功一轮即清零）");
ok(/isPollAborted\(jobId\)/.test(rpc) && /clearPollAbort\(jobId\)/.test(rpc),
  "wait 循环每轮开头查中止闸，收尾清登记（⛔ 不清 ⇒ 同 id 的下一次等待被误中止）");
ok(/Date\.now\(\) - startedAt >= local\.timeoutMs/.test(rpc),
  "wait 有超时上限（到点返回明确提示，不是无限等）");
ok(/sleepUntilPolled\(jobId, local\.intervalMs\)/.test(rpc) && /waited < total; waited \+= step/.test(rpc) && /isPollAborted\(taskId\)/.test(rpc),
  "等待**可被打断**（切成 250ms 小段、段间看中止闸）—— 否则间隔配到 2 分钟时按「中止」要等两分钟才停");
ok(/clearPollAbort\(jobId\);\n\s*let failures/.test(rpc) || /开等之前先清一次中止登记/.test(read("electron/features/dispatch-rpc.ts")),
  "开等之前清一次中止登记（⛔ 不清 ⇒ 上一次被中止的标记会留到这一次，一进来就「已被中止」）");
ok(/emit\(\{ action: "end", status: "success", result: saved\.path \}\)/.test(rpc) && /已生成并落盘/.test(rpc),
  "轮询结束后**照常输出最终结果**（落盘路径仍由工具返回值交给模型写进对话）");
ok(/wait: \{ type: "boolean"/.test(core) && /intervalMs: \{ type: "number"/.test(core) && /timeoutMs: \{ type: "number"/.test(core) && /maxRetry: \{ type: "number"/.test(core),
  "video_status 的工具面写明了 wait / 间隔 / 超时 / 重试（没写模型就不知道能托管等待）");
const registryOk = /prefix: "poll", count: 3/.test(registry) && /"poll:abort", "poll:config-read", "poll:config-save"/.test(registry);
const manifestOk = ["poll:config-read", "poll:config-save", "poll:abort"].every((ch) => manifest.channels.some((c) => c.channel === ch));
const compositionOk = composition.domains.some((d) => d.id === "poll" && d.file === "features/poll-ipc.ts" && d.enabled);
ok(registryOk && manifestOk && compositionOk, "poll 域三处登记齐全（ipc-registry / manifest / composition.json —— 少一处就是「通道从未注册」那类假功能）");
const pollIpc = codeOnly(read("electron/features/poll-ipc.ts"));
ok(/id: "poll"/.test(pollIpc) && /ipcHost\.handle\("poll:config-read"/.test(pollIpc) && /ipcHost\.handle\("poll:config-save"/.test(pollIpc) && /ipcHost\.handle\("poll:abort"/.test(pollIpc) && /ctx\.effect/.test(pollIpc),
  "poll 域是插件形态（defineFeature + 卸载时摘 handler）—— 与 queue-timer 同款");

/* ── ⑧【284】两侧常量同源（electron 与 src 各有字面量，改一边忘另一边 = 静默漂移）── */
{
  const main = codeOnly(read("electron/poll-config.ts"));
  const nums = (text, re) => (re.exec(text) ?? []).slice(1).join("|");
  const defRe = /intervalMs:\s*(\d+),\s*timeoutMs:\s*(\d+),\s*maxRetry:\s*(\d+)/;
  const mainDefaults = nums(main, defRe);
  const srcDefaults = nums(read("src/lib/poll-config.mjs"), defRe);
  ok(mainDefaults === srcDefaults && mainDefaults === "5000|600000|3",
    `【284】主进程与渲染层的默认值同源（${mainDefaults}）—— 两边各留一份字面量，改一边忘另一边就会「面板改了、跑起来还是老的」`);
  const limRe = /intervalMs:\s*\{\s*min:\s*(\d+),\s*max:\s*(\d+)\s*\}/;
  const mainLim = nums(main, limRe);
  const srcLim = nums(read("src/lib/poll-config.mjs"), limRe);
  ok(mainLim === srcLim && mainLim === "500|120000", `【284】间隔钳制边界同源（${mainLim}）`);
  const toRe = /timeoutMs:\s*\{\s*min:\s*(\d+),\s*max:\s*(\d+)\s*\}/;
  ok(nums(main, toRe) === nums(read("src/lib/poll-config.mjs"), toRe), "【284】超时钳制边界同源");
  const rRe = /maxRetry:\s*\{\s*min:\s*(\d+),\s*max:\s*(\d+)\s*\}/;
  ok(nums(main, rRe) === nums(read("src/lib/poll-config.mjs"), rRe), "【284】重试次数钳制边界同源");
  ok(/bindPollHost\(host\.app\)/.test(pollIpc) && /hostApp\?\.getPath\?\.\("userData"\)/.test(main) && !/^const .*app\.getPath/m.test(main),
    "userData **惰性求值**（【91】：模块体求 app.getPath 会拿到改写前的默认目录 ⇒ 配置静默漂移）");
}

/* ── ⑨ 桥：会话闸 + 回合补挂 ───────────────────────────────────────────────── */
const bridge = codeOnly(read("src/features/polling/PollBridge.tsx"));
const appView = codeOnly(read("src/features/app-view/AppView.tsx"));
ok(/payload\.type !== "poll"/.test(bridge) && /if \(threadId && target && target !== threadId\) return;/.test(bridge),
  "⛔ 会话闸：harness:event 广播到**所有窗口**，不比对 threadId 会把别的会话的轮询画到这里");
ok(/backfillPollTurn\(threadId, turnId\)/.test(bridge), "回合补挂（主进程只知道 threadId，回合归属由本窗口补）");
ok(/<PollBridge threadId=\{thread\?\.id \?\? ""\}/.test(appView), "整块只挂一次（模块级总线，挂两次会多一份订阅与一次 IPC）");
/* ── ⑨b 桥：引擎工具项 → 长命令追踪（10-09 用户追加那条的第二半）────────────── */
ok(/window\.codex\.onEvent\(/.test(bridge) && /"item\/started"/.test(bridge) && /"item\/completed"/.test(bridge),
  "桥监听**引擎工具项**事件（不再加一条 harness:event 广播 —— 工具项本来就在引擎事件流里，多一处发射点就多一处会漏）");
ok(/const WORK_ITEM_TYPES = new Set\(\[[\s\S]{0,240}?"commandExecution"/.test(bridge) && /beginToolWatch\(/.test(bridge) && /endToolWatch\(/.test(bridge),
  "工具项起止配对计时（commandExecution 等算「长」；reasoning/agentMessage 不算）");
/* 10-10 修「命令没有回传结果，就一直挂着」：旧断言只要求 `method === "turn/completed"` 后面跟着
   endToolWatchesOfTurn —— **它把 bug 当契约固化了**（① 只认一类结束事件；② turnId 取的是
   `params.turnId`，而 turn 类事件的 id 在 `params.turn.id` ⇒ 恒空串 ⇒ 兜底从未生效）。
   ⇒ 改成三条**正向**断言钉住正确形态。 */
ok(/TURN_END_METHODS = new Set\(\[[\s\S]{0,160}?"turn\/completed"[\s\S]{0,40}?"turn\/aborted"[\s\S]{0,40}?"turn\/failed"[\s\S]{0,40}?"turn\/interrupted"/.test(bridge)
  && /TURN_END_METHODS\.has\(method\)[\s\S]{0,240}?endToolWatchesOfTurn\(/.test(bridge),
  "回合结束兜底收尾认**四类**事件（只认 turn/completed ⇒ 被中断 / 失败 / 中止的回合留下永远在跑的幽灵 watch）");
ok(/endToolWatchesOfTurn\(String\(params\.turn\?\.id \?\? params\.turnId \?\? ""\)/.test(bridge),
  "⛔ turn 类事件的回合 id 在 `params.turn.id`（`params.turnId` 只是 item 类事件的字段）—— 取错 = 兜底恒不生效");
ok(/export function endToolWatchesOfTurn\(turnId: string, threadId\?: string\)/.test(storeSrc)
  && /orphanOfThread/.test(storeSrc),
  "store 侧按会话收孤儿 watch（事件的 turnId 缺省时也能收，否则永久残留 —— 长命令没有超时兜底）");
ok(/setToolAbortHandler\(\(\) => \{ abortRef\.current\?\.\(\); \}\)/.test(bridge) && /setToolAbortHandler\(null\)/.test(bridge),
  "「中止」回调注册/清理成对（回调走 ref：每次渲染都是新函数，直接进 deps 会让订阅反复重建）");
ok(/onAbortTool=\{\(\) => \{ void interrupt\(\); \}\}/.test(appView) && /onAbortTool\?: \(\) => void/.test(bridge),
  "AppView 把 `interrupt` 交给桥（长命令的中止 = 打断当前回合）—— 少了这行胶囊上那颗按钮点了没反应");
/* 真跑：长命令跑过阈值 ⇒ 登记成 kind:\"tool\" 的后台任务；结束 ⇒ 收尾 */
{
  const realNow = Date.now;
  const off2 = store.subscribePollStore(() => undefined);
  try {
    store.beginToolWatch({ id: "cmd-guard-1", threadId: "th-1", turnId: "tu-1", title: "命令 · npm run build" });
    Date.now = () => realNow() + 9000;            // ⛔ 拨表必须在 beginToolWatch **之后**：startedAt 是那一刻记的
    await new Promise((r) => setTimeout(r, 1250)); // 等一次看门狗 tick
    const promoted = store.getPollTask("tool:cmd-guard-1");
    ok(promoted?.status === "polling" && promoted?.kind === "tool" && promoted?.title === "命令 · npm run build",
      "真跑：长命令跑过阈值 ⇒ 登记成后台任务（kind=\"tool\"，胶囊里出现、对话流里不出现）");
    ok(Boolean(promoted) && !store.pollTasksOfTurn("tu-1").some((task) => task.kind === "tool"),
      "真跑：同一张任务表里，长命令**不进对话流**（pollTasksOfTurn 只给 `poll` 类卡）");
    Date.now = realNow;
    store.endToolWatch("cmd-guard-1");
    ok(store.getPollTask("tool:cmd-guard-1")?.status === "success",
      "真跑：工具项结束 ⇒ 后台任务收尾（不再计入「运行中」）");
  } finally {
    Date.now = realNow;
    off2();
  }
}
/* 真跑：**孤儿 watch**（事件的 turnId 缺省 ⇒ watch 记的是空串）也能被「按会话收尾」收掉 ——
   这是 10-10 修「命令没有回传结果，就一直挂着」的二级兜底；顺带验证**不跨会话误收**。 */
{
  const realNow = Date.now;
  const off3 = store.subscribePollStore(() => undefined);
  try {
    store.beginToolWatch({ id: "cmd-guard-2", threadId: "th-2", title: "命令 · 无回合 id" });
    Date.now = () => realNow() + 9000;
    await new Promise((r) => setTimeout(r, 1250));
    ok(store.getPollTask("tool:cmd-guard-2")?.status === "polling", "真跑：孤儿 watch（turnId 缺省）照样登记成后台任务");
    store.endToolWatchesOfTurn("tu-other", "th-3");   // 别的会话的回合结束
    ok(store.getPollTask("tool:cmd-guard-2")?.status === "polling", "⛔ 按会话收尾**不跨会话误收**（别的会话跑完不影响本会话挂着的命令）");
    Date.now = realNow;
    store.endToolWatchesOfTurn("tu-other", "th-2");   // 本会话的回合结束（turnId 对不上，纯靠会话兜底）
    ok(store.getPollTask("tool:cmd-guard-2")?.status === "failed", "真跑：本会话回合结束 ⇒ 孤儿 watch 被收尾（挂着的命令不再永久残留）");
  } finally {
    Date.now = realNow;
    off3();
  }
}

/* ── ⑨c 轮询完成后「自动继续」（10-10 用户反馈：回合结束后轮询还在，返回结果却没人推进）──────
   失效方式是**静默**的（界面看不出坏），所以三段都钉：
     ① 纯函数（文案 + 防循环常量，真跑）；② 桥把「成功终结」这一个事实通知出去；
     ③ 上层四道闸（只认 poll+成功 / 当前会话 / 空闲 / 额度）。 */
ok(typeof cfg.pollContinuePrompt === "function"
  && Number(cfg.POLL_AUTO_CONTINUE_WINDOW_MS) > 0 && Number(cfg.POLL_AUTO_CONTINUE_MAX_ATTEMPTS) > 0,
  "自动继续的文案与防循环常量在轮询纯函数库里（能被本守卫真跑 —— 判据不靠读代码猜）");
{
  const p = cfg.pollContinuePrompt({ title: "视频生成 · 可灵", result: "/workspace/a.mp4" });
  ok(/后台任务完成/.test(p) && /\/workspace\/a\.mp4/.test(p), "真值：续跑指令把**结果**带上（让模型接着干，不是重做一遍）");
  ok(/没有返回可读的结果文本/.test(cfg.pollContinuePrompt({ title: "x" })), "真值：结果为空也有明确交代（不能投一条空气进去）");
}
ok(/if \(status === "success"\)[\s\S]{0,220}?settledRef\.current\?\.\(settled\)/.test(bridge),
  "桥**只在轮询成功终结**时通知上层（失败 / 超时 / 中止没有可继续的结果）");
ok(/onPollSettled\?: \(task: PollTask\) => void/.test(bridge) && /const settledRef = useRef\(onPollSettled\)/.test(bridge),
  "onPollSettled 走 ref（每次渲染都是新函数，直接进 deps 会让订阅反复重建 —— 同 onAbortTool）");
ok(/onPollSettled=\{maybeAutoContinueAfterPoll\}/.test(appView),
  "AppView 把自动继续交给桥 —— 少了这行，结果到了也没人推进（用户报的正是这个）");
const queueSrc = codeOnly(read("src/features/app-state/parts/part04/03-seg/02-browser-queue-settings.tsx"));
ok(/function maybeAutoContinueAfterPoll\(task: PollTask\)/.test(queueSrc)
  && /task\.kind !== "poll"/.test(queueSrc) && /task\.status !== "success"/.test(queueSrc),
  "只对 `poll` 类且**成功**的任务续跑（长命令的结果就在对话里的工具卡上，不需要替它发言）");
ok(/bag\.threadRef\.current\?\.id !== threadId/.test(queueSrc) && /isTurnRunning\(entry\)/.test(queueSrc),
  "⛔ 两道会话闸：只对**当前会话**、且该会话**空闲**（有回合在跑 ⇒ 模型自己就在等结果，插队 = 重复推进）");
ok(/notePollAutoContinue\(threadId, POLL_AUTO_CONTINUE_WINDOW_MS, POLL_AUTO_CONTINUE_MAX_ATTEMPTS\)/.test(queueSrc),
  "自动继续有**次数闸**（防「结果 → 续跑 → 又开一个轮询」滚雪球烧钱）");
/* 真跑：防循环额度 —— 同会话窗口内到上限即停手；⛔ 额度**按会话隔离**（A 用满不能连累 B）。 */
{
  const w = cfg.POLL_AUTO_CONTINUE_WINDOW_MS, m = cfg.POLL_AUTO_CONTINUE_MAX_ATTEMPTS;
  let allowed = 0;
  for (let i = 0; i < m + 2; i += 1) if (store.notePollAutoContinue("th-quota-a", w, m)) allowed += 1;
  ok(allowed === m, `真跑：同会话窗口内放行 ${allowed}/${m} 次，到上限静默停手`);
  ok(store.notePollAutoContinue("th-quota-b", w, m) === true, "真跑：额度按会话隔离（一个会话卡死不会锁住别的会话）");
}

console.log(`\n【poll-board】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
if (fails) process.exitCode = 1;
