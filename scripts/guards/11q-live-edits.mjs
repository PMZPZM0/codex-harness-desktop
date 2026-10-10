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
ok(!watch.includes('turn-file-changes-live", turnId: entry.turnId, files: []')
  && watch.includes('if (broadcastFn) broadcastFn({ type: "turn-file-changes", turnId: entry.turnId, files: report });'),
  "收尾**不再发空 live 清场**、最终报告无条件广播（10-06 夜二改：编辑行冻结续命；渲染层收到 final 才清 live）");
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

/* ── 六、回合状态胶囊（10-06 夜三轮重构 · 用户对照 Qoder：「步骤 0/6 · 5 个文件已修改 +177 -8」
   + 「步骤清单跟文件修改，都是可以独立居中展示的，只是多了另一方展示的时候，就拼接展示」）────────
   与排队/询问/审批卡**上下排序**、悬停分区展开清单、随运行实时刷新；弹层位置**自适应 + 居中**。
   任务清单区（步骤 N/M）由 Codex 自己维护（task_add/task_update → tasks-changed 广播 → bag）。
   ⛔ 生命周期（夜四轮 + 夜六轮，用户实测三连）两区**都只活在回合运行中**：回合结束（跑完/被 stop）
   ⇒ 整卡消失；步骤全完成 ⇒ 步骤区隐藏；新回合开工 ⇒ 宿主清上一轮清单（不许跨回合残留）。 */
const capsule = codeOnly(read("src/features/status/TurnStatusCapsule.tsx"));
const composer = codeOnly(read("src/features/app-view/AppView/02-main-stage/03-composer.tsx"));
ok(capsule.includes("export function TurnStatusCapsule") && capsule.includes("getTurnLiveFileChanges(runningTurnId)") && capsule.includes("subscribeTurnFileChanges"),
  "回合状态胶囊：订阅 live、按运行中回合实时取数（文件区）");
ok(capsule.includes("const steps: StepRow[] = (Array.isArray(taskList) ? [...taskList] : [])") && capsule.includes('setZone("steps")') && capsule.includes('setZone("files")'),
  "步骤区取 Codex 的任务清单（taskList 入参）；左右悬停分区各自展开对应清单（用户令：放左边=步骤清单，放右边=文件）");
ok(capsule.includes("if (!hasSteps && !hasFiles) return null;"),
  "两区都没有才整卡不渲染（夜六轮起：非运行中两区都没内容 ⇒ 整卡消失 —— 用户「清单不会自动消失」的修法）");
ok(capsule.includes("{hasSteps && (") && capsule.includes("{hasFiles && (") && capsule.includes('hasSteps && hasFiles && <span className="capsule-sep"'),
  "两区**各自独立可显示（单独存在即居中）**；同时在才拼出「·」拼接展示（用户 10-06 夜定稿，别改成强制同现）");
ok(capsule.includes('const hasSteps = Boolean(runningTurnId) && steps.length > 0 && steps.some((step) => step.state !== "done")'),
  "⛔ 步骤区**只在回合运行中显示**（用户夜四轮「跑完没消失」+ 夜六轮「清单不会自动消失」——含被 /stop 停掉的回合；全完成时同样隐藏）");
ok(capsule.includes("if (!runningTurnId) { setZone(null); setPinned(false); setExpanded(false); }"),
  "回合结束清悬停分区与钉住/展开态（不清 ⇒ zone 残留在「渲染 null 的空档」里，下一回合一出现就凭空弹旧面板）");
ok(capsule.includes(".sort((a, b) => Number(a?.createdAt ?? 0) - Number(b?.createdAt ?? 0))"),
  "步骤按**创建顺序**展示（①②③④ 自上而下；store 接口序是 updatedAt 倒序，别直接铺）");
const taskStore = codeOnly(read("electron/rpa-store.ts"));
ok(taskStore.includes('every((t) => t.status === "done")) this.tasks = []'),
  "全完成清单在 task_add 时自动清掉 = 新一轮开新清单（用户 10-06 夜四轮「旧清单叠进新任务」；⛔ 只清全 done，批内 todo/doing 不许动）");
ok(capsule.includes("turn-step-row") && capsule.includes("CircleCheck") && capsule.includes("Circle") && capsule.includes("LoaderCircle"),
  "步骤清单三态渲染（todo ○ / doing ⟳ / done ✓）");
ok(/\.turn-step-row/.test(css) && /\.capsule-zone \{/.test(css),
  "步骤行 / 悬停分区样式在（CSS 真值核验，不靠类名出现）");
ok(/\.edited-files-card \{[^}]*text-align: center/.test(css),
  "胶囊居中展示（用户 10-06：「小胶囊在输入框上面，居中展示，不要靠左」）");
ok(capsule.includes("desiredViewLeft - rect.left"),
  "⛔ 弹层 left 按**相对卡片的偏移**写（absolute 基准是卡片；写视口坐标会叠加卡片左缘、画歪——10-06 实测 358→716）");
ok(capsule.includes("pillRef.current.getBoundingClientRect()") && capsule.includes("pop.style.maxHeight ="),
  "弹层锚点=胶囊 + maxHeight 按所选边可用空间收窄（自适应不被裁）");
ok(capsule.includes("anchorCenter - pr.width / 2"),
  "⛔ 弹层以**胶囊中心**居中（用户 10-06：「放上去展示的那个也要居中」；左缘对齐会看着偏向右）");
ok(composer.includes("<TurnStatusCapsule") && composer.includes("taskList={taskList}")
  && composer.indexOf("<TurnStatusCapsule") > composer.indexOf('className="approval-stack"')
  && composer.indexOf("<TurnStatusCapsule") < composer.indexOf("<ComposerComposerForm")
  && /composer-status-row[\s\S]{0,200}<TurnStatusCapsule[\s\S]{0,400}<BackgroundTaskCapsule/.test(composer),
  "⛔ 位置（10-11 用户改版）：在**状态行**里（composer-status-row）与后台任务胶囊**同一排**自适应排版、\n"
  + "紧挨输入框（ComposerComposerForm 之前）—— 不再各占一行留大片空白；行空时 :empty 整行隐藏");

/* ── 六-c、新回合开工清上一轮清单（10-06 夜六轮，用户实测「新回合，旧的任务清单还在」）────────
   上一轮停下（todo/doing 残留）的清单不许跨回合冒出来：空闲直发 → 宿主 tasks:clear（真通道+广播）
   → 模型在新回合 task_list 读到空清单、按需重建。⛔ 排队分支不清（旧回合还在跑，清单要用）；
   goal 引擎自续回合不走 send() ⇒ 天然不受影响。 */
const tasksFeature = codeOnly(read("electron/features/tasks-ipc.ts"));
const taskStoreSrc = codeOnly(read("electron/rpa-store.ts"));
const manifest = read("electron/ipc-channels.manifest.json");
const sendSrc = codeOnly(read("src/features/app-state/parts/part08/02-seg/send.tsx"));
ok(manifest.includes('"channel": "tasks:clear"') && tasksFeature.includes('ipcHost.handle("tasks:clear"') && taskStoreSrc.includes("async clearTasks()"),
  "tasks:clear 通道贯通：manifest（单一真相源）→ tasks-ipc handler → rpa-store.clearTasks");
ok(/ipcHost\.handle\("tasks:clear"[\s\S]{0,300}notifyTasksChanged\(\)/.test(tasksFeature) && tasksFeature.includes('"tasks:clear"]) ipcHost.removeHandler'),
  "清空后广播 tasks-changed（胶囊即刻归零）+ ctx.effect 卸载时摘 handler");
ok(read("electron/preload.ts").includes('clearTasks: () => __ipc("tasks:clear", 0, [])'),
  "preload 桥接为 gen:ipc 生成物（手改生成物会被预检守卫【2】打红）");
ok(sendSrc.includes("await window.codex.clearTasks()") && !sendSrc.includes('request("tasks:clear"')
  && sendSrc.indexOf("await window.codex.clearTasks()") < sendSrc.indexOf("result = await startTurn(active)")
  && sendSrc.indexOf("await window.codex.clearTasks()") > sendSrc.indexOf('window.codex.request("thread/queue/add"'),
  "挂钩 = **空闲直发路径、首个 startTurn 之前 await 落地**（⛔ 走 window.codex.clearTasks() 类型化宿主方法 —— codex.request() 是引擎 RPC，真跑实测转给 app-server 报 unknown variant、被 catch 吞成「清了但没清」；顺序反了会清掉模型刚建的新清单；排在排队分支之后 = 排队时不清正在跑的清单）");

/* ── 六-b、旧「目标与进程」UI 已撤（10-06 夜三轮用户令）——负向断言防复活 ────────────── */
const seg9 = codeOnly(read("src/features/app-state/parts/part09/02-seg.tsx"));
ok(!seg9.includes("tb-goals-entry") && !existsSync(join(ROOT, "src/features/app-view/AppView/02-main-stage/02-goals-bar.tsx")),
  "⛔ 旧「目标与进程」入口按钮与面板不许回来（任务清单的唯一常驻入口 = 回合状态胶囊）");
ok(!/\.goals-pop\s*\{/.test(css) && !/\.tb-goals-entry\s*\{/.test(css) && !/\.goals-task-list/.test(css),
  "⛔ goals-* / tb-goals-* 样式已随 UI 一并清理（别留死样式；@keyframes pulse 除外，它还有别的消费方）");

/* ── 七、收尾汇报（10-10 三改 · 用户定稿：**汇总消息下面**的富卡片，⛔ 别再挪位置）──────────
   收尾的「已编辑文件」只由 03-turn-view 的 `<CompletedChanges>`（汇总消息下面）负责，富卡片形态
   （头部计数 + 文件行 + 悬停 diff）；SessionQueue 里**不许**再插任何收尾编辑块 —— 曾插在
   「过程与最终答复之间」，折叠口径改掉后跑到汇总上面，用户截图痛骂（10-10 二轮）。
   ⛔ 兜底在 CompletedChanges 里：最终报告缺失（中断/异常漏结算）时用还在的 live 数据顶上。 */
ok(!sessionQueue.includes("frozenEditRows") && !sessionQueue.includes("frozenFiles"),
  "⛔ SessionQueue 不再有任何收尾编辑块（曾插在汇总上面 —— 用户 10-10 截图痛骂后撤除）");
ok(status.includes("const tracked = finalReport.length ? finalReport : getTurnLiveFileChanges(turn.id);"),
  "⛔ 汇报卡兜底：最终报告缺失时由 live 数据顶上（板块不凭空消失；富卡片形态不变）");
ok(sessionQueue.includes("const liveRowsFor = (itemId: string) => {") && sessionQueue.includes("if (!running) return null;")
  && (sessionQueue.match(/renderAfter=\{\(unit\) => liveRowsFor\(unit\.item\.id\)\}/g) ?? []).length === 2,
  "运行中的就地锚定保持原样（仅运行态两处 renderAfter；收尾态不锚回折叠里）");
ok(!sessionQueue.includes("saveEditAnchors") && !sessionQueue.includes("loadEditAnchors"),
  "⛔ 锚点 localStorage 持久化已随冻结块方案撤掉（放进折叠的落位在收起状态下等于没显示）");

console.log(`\n【live-edits】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
