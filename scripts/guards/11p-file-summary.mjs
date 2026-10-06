/**
 * 「汇总消息底部 · 已更改 N 个文件」汇报卡判据（10-06 立；用户对照 Qoder 效果图点名：
 * 「汇总消息底部显示文件…这个生成文件直接打开预览就行，和右键打开文件地址和复制文件路径…修改文件下面效果，还有生成的图片」）。
 *
 * ⛔ 这块 UI 的失效方式全是**静默的**：行点了没反应（没接 onOpenFile / 被按钮点击吞掉）、
 * 右键菜单漏项、折叠阈值被删掉一口气铺满、图片行退化成文字块 —— tsc 与预检全绿。
 * 本守卫钉**代码形态 + 复用关系**；行为（真点、真右键、真复制）由验收项 `file-summary` 在真产物上跑。
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
  console.log(`  ${condition ? "✓" : "✗"} 【file-summary】${message}`);
  if (!condition) fails++;
};

const status = read("src/features/status/Status.tsx");
const statusCode = codeOnly(status);
const shared = read("src/features/shared/InlineCards.tsx");
const turnView = codeOnly(read("src/features/session-turn/SessionTurn/03-turn-view.tsx"));
const css = read("src/styles/04-cards-tools.css");

/* ── 一、汇报卡本体：点行预览 / 右键菜单 / 折叠 ───────────────────────────── */

ok(status.includes("export function CompletedChanges({ turn, onOpenFile }"), "汇报卡收 onOpenFile（没有它 = 行点了没反应，onOpenFile 永远 undefined）");
ok(/onClick=\{\(\) => openPath\(file\.path, name\)\}/.test(statusCode), "行点击 → openPath（用户点名：直接打开预览）");
ok(/onContextMenu=\{\(event\) => \{ event\.preventDefault\(\); setMenu\(/.test(statusCode), "行右键 → 弹文件卡菜单");
ok(statusCode.includes("openImageLightbox(path, name)") && statusCode.includes("onOpenFile?.(path)"),
  "openPath 分流：图片走灯箱、其余走文件预览（与消息内联卡片同口径，别各写一套）");
ok((statusCode.match(/event\.stopPropagation\(\)/g) ?? []).length >= 2,
  "行内按钮（审查 / 打开）各自 stopPropagation —— 否则点按钮连着行点击一起触发（预览 + 弹窗双开）");
ok(statusCode.includes("const COLLAPSE_LIMIT = 2;") && statusCode.includes("files.slice(0, COLLAPSE_LIMIT)"),
  "默认只露 2 行、其余自动收纳（用户 10-06 夜令：「已修改那个文件，最多一次展示 2 行，多了的自动放进收纳里面」——一口气铺满会把消息区顶飞；阈值常量要在）");
ok(/expanded \? "收起" : `再显示 \$\{files\.length - COLLAPSE_LIMIT\} 个文件`/.test(statusCode),
  "折叠钮文案：再显示 N 个文件 / 收起（用户点名的「再显示 12 个文件」式交互）");
ok(statusCode.includes('className="completed-file-thumb"') && statusCode.includes("imageUrl(file.path)"),
  "图片文件显示缩略图（用户点名「还有生成的图片」——不许退化成 PNG 文字块）");
ok(statusCode.includes('className="completed-file-new">新增'), "宿主追踪的新增文件打「新增」徽标（与「已删除」成对）");

/* ── 二、右键菜单：复用一份 + 两项点名 ───────────────────────────── */

ok(statusCode.includes('import { FileCardMenu } from "../shared/InlineCards"'),
  "菜单是**复用** shared 基座的那一份（第二份菜单实现 = 两处真相源，改一处漏一处）");
ok(shared.includes("export function FileCardMenu"), "shared 的 FileCardMenu 已导出（复用面）");
ok(shared.includes('label: "复制文件路径"') && shared.includes("copyTextToClipboard(menu.path)"),
  "菜单含「复制文件路径」且真的写剪贴板（挂空按钮 = 点了没反应）");
ok(shared.includes('label: "在文件夹中显示"') && shared.includes("shellReveal(menu.path)"),
  "菜单含「在文件夹中显示」= 用户说的「打开文件地址」（走 shell:reveal）");
ok(/\(editable \? 5 : 4\) \* itemH/.test(shared),
  "菜单高度按 5/4 项算（加了菜单项不改高度 ⇒ 视口翻转判断错位，菜单会跑出屏幕）");

/* ── 三、接线与样式 ───────────────────────────────────────────── */

ok(turnView.includes("<CompletedChanges turn={turn} onOpenFile={handlers.onOpenFile} />"),
  "turn-view 把 handlers.onOpenFile 递进汇报卡（不递 = onOpenFile 永远 undefined，行点击静默失效）");
ok(/\.completed-file\.clickable:hover/.test(css) && /\.completed-file-thumb img/.test(css) && /\.completed-more:hover/.test(css),
  "样式齐：行 hover / 缩略图裁切 / 折叠钮 hover（少一个 = 看着像坏了）");

/* ── 四、数据链路：id 链 / 真投递通道 / 遍历顺序 ─────────────────────────────
   ⛔ 10-06 用户真实场景暴露的三处静默缺陷，全在「注入假事件」式验收的盲区里（卡会画、链路是死的）：
   ① 追踪器广播的是**线程 id**，汇总卡按 **turn.id** 取报告 ⇒ 永远对不上号、卡片空白；
   ② 渲染层监听 window "message" 通道 —— 全仓没有任何发送方（真通道是 onHarnessEvent 裸 payload）；
   ③ 工作区遍历是深度优先：大子目录（AppData…）先烧光 4000 文件预算，根级新文件永远进不了快照。
   本节的断言逐条钉住这三处的**修法本身**（id 从哪来、走哪条通道、按什么顺序走盘）。 */

const boot = codeOnly(read("electron/features/boot.ts"));
const watch = codeOnly(read("electron/turn-file-watch.ts"));
const changesMod = codeOnly(read("src/lib/turn-file-changes.mjs"));

ok(/snapshotTurnWorkspace\(threadIdOf,\s*id,\s*startCwd\)/.test(boot),
  "boot 把**回合 id**随快照传给追踪器（漏传/传 threadIdOf ⇒ 广播对不上 turn.id）");
ok(boot.includes("const id = turnIdOf(p);") && /if \(id\) engineActiveTurnIds\.set\(id, threadIdOf\);/.test(boot),
  "turn/started 分支里回合 id 仍是宽容三形态解析（id 记进活跃台账 + 快照共用同一个值）");
ok(watch.includes('snaps.set(id, { turnId: String(turnId ?? ""), cwd: dir, snap: walk(dir) })'),
  "快照条目存住 turnId（线程 id 只当快照键/结算键，两个 id 职责分开）");
ok(/broadcastFn\(\{ type: "turn-file-changes", turnId: entry\.turnId, files: report \}\)/.test(watch) && !/turnId:\s*id\s*,/.test(watch),
  "广播 turnId = entry.turnId（⛔ 不许退回线程键 id —— 对不上号 = 卡永远空白）");
ok(changesMod.includes("window.codex.onHarnessEvent") && /type !== "turn-file-changes" && type !== "turn-file-changes-live"/.test(changesMod),
  "渲染层收件走真通道 onHarnessEvent（裸 payload；最终报告与运行中 live 两类都收）");
ok(!/addEventListener\("message"/.test(changesMod),
  "⛔ 不再监听 window \"message\"（死信道：全仓无发送方；改回来 = 卡静默空白）");
ok(statusCode.includes("getTurnFileChanges(turn.id)") && statusCode.includes("subscribeTurnFileChanges((changedTurnId"),
  "汇总卡按 turn.id 取报告并订阅刷新（取键与广播键同源）");
ok(watch.includes("const dirs: string[] = [];") && watch.includes("for (const d of dirs) visit(d, depth + 1);"),
  "工作区遍历文件优先：先收本层文件、再下潜子目录（DFS 会被大子目录烧光预算，根级新文件不见）");
// 收尾双保险（10-06 夜，新机器实测「运行中行有、收尾卡没有」）：部分引擎版本的结束事件
// 形态不同、拿不到 threadId ⇒ 按线程键找不到快照、静默漏结算。快照条目里存了 turnId →
// 按回合 id 反查补结算。正常路径命中后本兜底是 no-op（快照已删）。
ok(watch.includes("export function settleTurnByTurnId") && /if \(entry\.turnId === id\) \{ emitTurnFileChanges\(threadId\); return; \}/.test(watch),
  "收尾兜底：settleTurnByTurnId 按回合 id 反查快照结算（结束事件缺 threadId 的引擎形态也能出卡）");
ok(boot.includes("if (id) settleTurnByTurnId(id);"),
  "boot 收尾分支调用反查兜底（先线程键、再回合键——防漏结算）");

/* ── 五、浮层免疫（10-06 用户实测「弹窗那个叉掉被遮住了 / 关不掉」）─────────────────────────
   `.turn-group` 上有**恒等 transform**（matrix(1,0,0,1,0,0)）——恒等也照样创建 containing block，
   让 `position:fixed` 的「审查弹窗遮罩」退化成该回合的盒子（实测 481px），弹窗居中后被顶出屏幕、
   头部（含关闭键）被切掉。修法 = createPortal 到 body（右键菜单同理：fixed + 视口坐标会被整体偏移）。 */

ok(statusCode.includes("createPortal((") && statusCode.includes("), document.body)") && statusCode.includes('className="turn-diff-modal-mask"'),
  "审查弹窗 createPortal 到 body（留在回合内 = fixed 退化、关闭键被切）");
ok(statusCode.includes('event.key === "Escape"') && statusCode.includes("setReview(null)"),
  "审查弹窗 Esc 可关（关闭键被切时的兜底）");
ok(/\.turn-diff-modal \{[\s\S]{0,280}?display: flex;/.test(css) && /\.turn-diff-modal \{[\s\S]{0,280}?overflow: hidden;/.test(css) && /\.turn-diff-modal \.tool-code-block \{[\s\S]{0,120}?flex: 1 1 auto;/.test(css),
  "审查弹窗外框不滚、头部常驻、代码区占满剩余高度自己滚（长 diff 不再把关闭键滚出视野）");
const shared2 = codeOnly(read("src/features/shared/InlineCards.tsx"));
ok(shared2.includes('return createPortal((') && shared2.includes('), document.body);'),
  "文件卡右键菜单也 portal 到 body（position:fixed + 视口坐标，留在回合内会被整体偏移）");

/* ── 六、汇总卡行悬停的 diff 预览（10-06 夜 · 用户图一：「鼠标放到汇总的修改的文件名上」；
   ⛔ 用户令「预览窗口要自适应展示位置，别固定，固定容易截掉、展示不全」）───────────────── */

ok(statusCode.includes('className="completed-diff-preview"') && statusCode.includes("hoverOpenTimerRef.current"),
  "行悬停出 diff 预览（悬停意图定时器：扫过一行不弹、停住才弹）");
ok(/Math\.max\(M, Math\.min\(rect\.left, vw - width - M\)\)/.test(statusCode) && statusCode.includes("maxHeight={diffHover.codeMax}"),
  "⛔ 预览位置自适应：上下按空间选边 + 钳进视口 + 代码区高度按所选边收窄（不许固定坐标）");

/* ── 七、预览升级（10-06 夜二改 · 用户对照 Qoder：「他这种预览好看，鼠标放上去还能左右滚动和
   上下滚动，我们现在的 diff 预览好丑」）────────────────────────────────
   形态：双行号槽 + 彩色行 + 两轴滚动（overflow:auto + 行 white-space:pre 不折行）+
   面板内滚动**不关窗**（旧实现在捕获阶段一律关窗 ⇒「想滚先关窗」，用户实测复现）。 */
const diffPreview = read("src/features/status/DiffPreview.tsx");
const diffView = read("src/lib/diff-view.mjs");
ok(statusCode.includes('import { DiffPreviewBody } from "./DiffPreview"') && statusCode.includes("<DiffPreviewBody text={diffHover.diff} maxHeight={diffHover.codeMax} />"),
  "悬停预览正文换成 DiffPreviewBody（带行号槽的渲染器；不再裸 ToolCodeBlock 文本）");
ok(statusCode.includes("panel.contains(event.target)") && statusCode.includes("hoverPanelRef.current"),
  "⛔ 面板内部滚动不关闭预览（用户令：鼠标放上去要能左右/上下滚动；缺了 = 想滚先关窗）");
ok(statusCode.includes('className="completed-diff-expand"') && statusCode.includes("<Maximize2"),
  "预览头带「打开完整 diff」钮（对照 Qoder 预览头的展开键）");
ok(diffPreview.includes("parseDiffLines") && diffPreview.includes('className="diffp-no"') && diffPreview.includes("diffp-line"),
  "DiffPreviewBody：双行号槽 + 差分行渲染（数据来自纯函数 parseDiffLines，一行一 div）");
ok(/\.diffp \{[^}]*overflow: auto/.test(css) && /\.diffp-line \{[^}]*white-space: pre/.test(css),
  "预览两轴滚动（overflow:auto + 行不折行 ⇒ 长行天然出横向滚动条）");
ok(/\.diffp-line\.add \{[^}]*color-mix/.test(css) && /\.diffp-line\.del \{[^}]*color-mix/.test(css),
  "增删行彩色行底（色值走主题变量 color-mix，深色/浅色都跟主题走）");
ok(diffView.includes("export function parseDiffLines") && diffView.includes("inHunk"),
  "parseDiffLines 纯函数在（hunk 头解析行号；`---`/`+++` 只在进 hunk 前算文件头——避免吞内容行）");

/* ── 八、持久化（10-06 夜二改 · 用户实测「重启应用，那个下面已修改的文件那个板块不见了」）────
   落盘：收尾报告按线程写 <userData>/turn-file-changes/<threadId>.json；
   重播：codex-ipc 在 thread/resume 时按原事件形态重发（渲染层收件零改动）⇒ 重启后卡与冻结行都在。 */
const ipcCode = codeOnly(read("electron/features/codex-ipc.ts"));
ok(watch.includes("export function setTurnFileWatchStore") && watch.includes("export function storedReportsForThread") && watch.includes("const MAX_TURNS_PER_THREAD"),
  "追踪器落盘 API：目录注入 + 存量读取 + 防呆上限（每线程 40 回合 / 单文件 1.5MB）");
ok(watch.includes("store[String(entry.turnId)] = { at: Date.now(), files: report }") && watch.includes("pruneAndPersistTurn(id, store)"),
  "收尾时把最终报告写进 <threadId>.json（重启后卡片与编辑行的数据源）");
ok(boot.includes('setTurnFileWatchStore(path.join(app.getPath("userData"), "turn-file-changes"))')
  && boot.indexOf("setTurnFileWatchStore(") > boot.indexOf("export async function bootApp"),
  "boot 注入落盘目录，且**在 bootApp 内**求值（⛔ 模块顶层求值 app.getPath = 路径静默漂移，守卫【91】同款红线）");
ok(ipcCode.includes("storedReportsForThread(String(r.thread.id))") && ipcCode.includes('type: "turn-file-changes", turnId: stored.turnId'),
  "codex-ipc 在 thread/resume 时把存量报告按原事件形态重播（重启/切回会话后卡片与编辑行复活）");
ok(watch.includes("export function dropStoredReports") && boot.includes("dropStoredReports(goneId)") && ipcCode.includes("dropStoredReports(purgeTarget)"),
  "两处删除入口都清落盘报告（boot 的 thread/deleted 通知 + codex-ipc 的渲染层删除——与 delegateRegistry.forget 同点，别让 userData 越攒越多）");

/* ── 九、parseDiffLines 真值表（纯函数**真跑**——行号/文件头判据出错的失效方式是静默的：
   行号错位只是数字难看不会报错；`---` 判错会吞内容行，预览直接缺行）────────────────── */
{
  const { parseDiffLines } = await import("../../src/lib/diff-view.mjs");
  const rows = parseDiffLines("@@ -5,2 +5,3 @@\n ctx\n-old\n+new1\n+new2");
  ok(rows[0].kind === "hunk" && rows[1].kind === "ctx" && rows[1].oldNo === 5 && rows[1].newNo === 5
    && rows[2].kind === "del" && rows[2].oldNo === 6 && rows[2].newNo === null
    && rows[3].kind === "add" && rows[3].newNo === 6 && rows[4].kind === "add" && rows[4].newNo === 7,
    `行号真值：hunk 头起算、旧/新各自计数（实得 ${JSON.stringify(rows.map((r) => [r.kind, r.oldNo, r.newNo]))}）`);
  const inside = parseDiffLines("+++ b/x\n@@ -1 +1 @@\n---not-a-header");
  ok(inside[0].kind === "meta" && inside[2].kind === "del" && inside[2].text === "--not-a-header",
    "`--- `/`+++ ` 只在进 hunk 之前算文件头（进 hunk 后是内容行——判错会吞行）");
  const fileHead = parseDiffLines("--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n keep");
  ok(fileHead[0].kind === "meta" && fileHead[1].kind === "meta" && fileHead[3].oldNo === 1,
    "未进 hunk 的 `---`/`+++` 是文件头（meta 且不占行号）");
}

console.log(`\n【file-summary】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
