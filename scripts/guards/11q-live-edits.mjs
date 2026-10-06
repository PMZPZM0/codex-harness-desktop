/**
 * 运行中「编辑 <文件> +N -M」实时行判据（10-06 立；用户对照 WorkBuddy 截图，并纠正过一次：
 * 「运行中是运行中的 —— 在编辑板块对应文件后面 +-n 数字；汇总是汇总，两个不要搞错了」）。
 *
 * 失效方式全是静默的：广播没接线（行永远不出现）、id 对不上（挂不到回合）、
 * **卡片化/总计头回归**（又把运行中做成"第二个汇总"——用户点名禁止的形态）、
 * 图标表被删 / 行内徽章掉了（看着像退版）。本守卫钉代码形态；
 * 行为由验收 `file-summary` 在真回合里跑（行出现 + 行数随批次写入增长 = 实时在更新）。
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
  console.log(`  ${condition ? "✓" : "✗"} 【live-edits】${message}`);
  if (!condition) fails++;
};

const watch = codeOnly(read("electron/turn-file-watch.ts"));
const mod = codeOnly(read("src/lib/turn-file-changes.mjs"));
const status = codeOnly(read("src/features/status/Status.tsx"));
const turnView = codeOnly(read("src/features/session-turn/SessionTurn/03-turn-view.tsx"));
const itemView = codeOnly(read("src/features/session-queue/ItemView.tsx"));
const icon = codeOnly(read("src/components/FileTypeIcon.tsx"));
const css = read("src/styles/04-cards-tools.css");
const cssTurns = read("src/styles/03-messages-turns.css");

/* ── 一、主进程：轻量重扫 + live 广播 + 收尾清场 ───────────────────────────── */

ok(watch.includes("async function walkLight") && watch.includes("fs.promises.readdir") && watch.includes("fs.promises.stat"),
  "异步轻量重扫 walkLight（只 stat 不读全文 —— 每 2.5s 一圈不许把主进程卡住）");
ok(watch.includes("const LIVE_POLL_MS = 2500;") && watch.includes("setInterval(() => { void pollLiveOnce(); }, LIVE_POLL_MS)"),
  "2.5s 轮询器存在（比这更密 = 白扫；删了 = 运行中永远是死画面）");
ok(watch.includes("ensureLiveTimer();"),
  "快照建立后立刻启动轮询（漏掉 = 运行中永远没有实时行）");
ok(watch.includes('broadcastFn({ type: "turn-file-changes-live", turnId: entry.turnId, files: report })'),
  "live 广播带**回合 id**（与最终报告同一条 id 链，否则挂不到回合上）");
ok(watch.includes('broadcastFn({ type: "turn-file-changes-live", turnId: entry.turnId, files: [] });')
  && watch.indexOf('turn-file-changes-live", turnId: entry.turnId, files: []') < watch.indexOf('turn-file-changes", turnId: entry.turnId, files: report'),
  "收尾先发空 live 清场、再发最终报告（顺序反了 = 运行中行残留 / 汇总被顶）");
ok(watch.includes("liveLastSent.set(threadId, sig)") && watch.includes("if (sig === liveLastSent.get(threadId)) continue;"),
  "同内容去重（没有它 = 每 2.5s 白广播一次）");

/* ── 二、渲染层收件 ───────────────────────────────────────── */

ok(mod.includes('type !== "turn-file-changes-live"') && mod.includes("liveReports.set(turnId, files)") && mod.includes("liveReports.delete(turnId)"),
  "渲染层收 live 事件，且 final 到达时清 live（两态互斥，不许两张卡并存）");
ok(mod.includes("export function getTurnLiveFileChanges") && mod.includes("export function getTurnFileChanges"),
  "live 与 final 两个 getter 并存（运行中与汇总各读各的）");

/* ── 三、运行中行（⛔ 不是卡片！用户点名的形态）+ 就地锚定（10-06 二次纠正：在哪个地方发生就显示在哪个地方）─ */

const sessionQueue = codeOnly(read("src/features/session-queue/SessionQueue.tsx"));
const sessionCards = codeOnly(read("src/features/session-cards/SessionCards.tsx"));

ok(status.includes("export function LiveFileRows") && status.includes('className="live-edit-row"') && status.includes('className="live-edit-stats"') && status.includes("<Pencil"),
  "LiveFileRows（哑渲染）：行 = 铅笔 + 类型图标 + 文件名 + 目录 + 实时 +N -M");
ok(!status.includes('className="live-changes"') && !status.includes("live-changes-head") && !status.includes("live-changes-totals"),
  "⛔ 不许把运行中做成卡片 / 带总计头（用户 10-06 明确：运行中是运行中的，汇总是汇总）");
ok(sessionQueue.includes("liveAnchorsRef") && sessionQueue.includes("getTurnLiveFileChanges(turn.id)") && sessionQueue.includes("subscribeTurnFileChanges"),
  "TurnFoldStream 订阅 live 并按**首次出现时刻的最后一项**定锚（liveAnchorsRef）");
ok(sessionQueue.includes("renderAfter={(unit) => liveRowsFor(unit.item.id)}") && (sessionQueue.match(/renderAfter=\{\(unit\) => liveRowsFor\(unit\.item\.id\)\}/g) ?? []).length >= 2,
  "两个渲染口（折叠段 + 运行尾段）都把实时行挂在对应工具项**后面**（用户：不是一直在新消息下面）");
ok(sessionCards.includes("renderAfter?: (unit: FoldUnit) => React.ReactNode") && sessionCards.includes("renderAfter ? renderAfter(unit) : null"),
  "CappedToolSequence / CappedToolRun 支持 renderAfter（锚点行按序插在每条工具项后面）");
ok(turnView && !turnView.includes("LiveFileChanges") && turnView.includes("{turnFinished && <CompletedChanges turn={turn} onOpenFile={handlers.onOpenFile} />}"),
  "回合视图：底部只剩收尾汇总卡；运行中实时行**不在底部**（由折叠流锚定渲染）");

/* ── 四、文件类型图标 ───────────────────────────────────────── */

ok(icon.includes("export function FileTypeIcon") && icon.includes("export function fileTypeVisual"),
  "FileTypeIcon 组件 + 纯函数（扩展名 → 图标/配色，一处真相源）");
ok(["py", "ts", "js", "md", "json", "svg", "yml"].every((ext) => icon.includes(`"${ext}"`)),
  "图标表覆盖常用扩展名（py/ts/js/md/json/svg/yml…）");
ok(status.includes('<FileTypeIcon path={file.path} size={15} className="completed-file-icon" />') && !status.includes("fileChip"),
  "汇总卡行用 FileTypeIcon（旧的文字彩色块已删，别回来）");
ok(itemView.includes('<FileTypeIcon path={path} size={12} />') && itemView.includes('className="action-diff-head"') && itemView.includes('className="action-diff-stats"'),
  "编辑卡（引擎 fileChange 路径）行头 = 类型图标 + 路径 + 本行实时 +N -M");

/* ── 五、样式 ───────────────────────────────────────── */

ok(/\.live-edit-row/.test(css) && /\.live-edit-stats/.test(css) && /@keyframes live-tick/.test(css),
  "运行中行样式 + live-tick 跳动动画都在（数字变化重放一次动画）");
ok(!/\.completed-file-chip\s*\{/.test(css), "⛔ 已删的彩色块样式不许回来（死样式）");
ok(/\.action-diff-head/.test(cssTurns) && /\.action-diff-stats/.test(cssTurns),
  "编辑卡行头样式在（图标 + 路径 + 徽章一行排）");

console.log(`\n【live-edits】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
