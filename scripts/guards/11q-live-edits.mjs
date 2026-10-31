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
import { fileURLToPath, pathToFileURL } from "node:url";
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
ok(/broadcastFn\(\{ type: "turn-file-changes-live",(?: threadId,)? turnId: entry\.turnId, files: report \}\)/.test(watch),
  "live 广播带**回合 id**（与最终报告同一条 id 链，否则挂不到回合上）；threadId 是手机端筛选用的（10-28 加）");
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
ok(turnView && !turnView.includes("LiveFileChanges") && /turnFinished && <CompletedChanges turn=\{turn\} onOpenFile=\{handlers\.onOpenFile\}(?: isLastTurn=\{isLastTurn\})? \/>/.test(turnView),
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
ok(capsule.includes("const steps: StepRow[] = mergeTaskSteps(taskList)") && capsule.includes('from "../../lib/task-steps.mjs"') && capsule.includes('setZone("steps")') && capsule.includes('setZone("files")'),
  "步骤区取 Codex 的任务清单（taskList 入参），归并口径来自纯函数 lib/task-steps.mjs；左右悬停分区各自展开对应清单");
/* 10-22 用户截图「任务清单重复渲染」：每一步成对出现、胶囊写「步骤 0/10」而磁盘上只有 5 条
   （同一条 task_add 被两路写入，重放时 call id 变了 ⇒ 按 id 去重拦不住）。
   显示层必须**按文本归并**，冲突时保留状态最靠后的那条（⛔ 丢进度比重复更糟）。
   ⛔ 口径只许写在纯函数里：组件里出现第二份 `byText` = 两份真相源，迟早分叉。 */
const taskSteps = codeOnly(read("src/lib/task-steps.mjs"));
ok(/for \(const row of rows\)[\s\S]{0,200}byText\.get\(row\.text\)/.test(taskSteps)
  && /STATE_RANK\[row\.state\] \?\? 0\) > \(STATE_RANK\[prev\.state\] \?\? 0\)/.test(taskSteps)
  && /\.sort\(\(a, b\) => a\.createdAt - b\.createdAt\)/.test(taskSteps),
  "同一句话只显示一次（按 text 归并 + 保留 done>doing>todo 的最靠后状态），顺序按首次创建");
ok(!capsule.includes("byText") && !capsule.includes("STATE_RANK"),
  "⛔ 组件里不许再写第二份归并逻辑（唯一真相源 = lib/task-steps.mjs）");
ok(capsule.includes("if (!hasSteps && !hasFiles) return null;"),
  "两区都没有才整卡不渲染（夜六轮起：非运行中两区都没内容 ⇒ 整卡消失 —— 用户「清单不会自动消失」的修法）");
ok(capsule.includes("{hasSteps && (") && capsule.includes("{hasFiles && (") && capsule.includes('hasSteps && hasFiles && <span className="capsule-sep"'),
  "两区**各自独立可显示（单独存在即居中）**；同时在才拼出「·」拼接展示（用户 10-06 夜定稿，别改成强制同现）");
ok(capsule.includes('const hasSteps = Boolean(runningTurnId) && steps.length > 0 && steps.some((step) => step.state !== "done")'),
  "⛔ 步骤区**只在回合运行中显示**（用户夜四轮「跑完没消失」+ 夜六轮「清单不会自动消失」——含被 /stop 停掉的回合；全完成时同样隐藏）");
ok(capsule.includes("if (!runningTurnId) { setZone(null); setPinned(false); setExpanded(false); }"),
  "回合结束清悬停分区与钉住/展开态（不清 ⇒ zone 残留在「渲染 null 的空档」里，下一回合一出现就凭空弹旧面板）");
ok(capsule.includes(".sort((a, b) => a.createdAt - b.createdAt)") || taskSteps.includes(".sort((a, b) => a.createdAt - b.createdAt)"),
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
  /* ── 布局规则定稿（10-11 用户）：居中/靠左各归原位、同现同行、询问审批覆盖、排队在下 ── */
  ok(/\.composer-status-row \{[^}]*grid-template-columns: 1fr auto 1fr/.test(css)
    && /\.composer-status-row \.edited-files-card \{[^}]*grid-column: 2[^}]*grid-row: 1/.test(css)
    && /\.composer-status-row \.poll-bg-wrap \{[^}]*grid-column: 1[^}]*grid-row: 1/.test(css),
    "⛔ 三列网格：后台胶囊=首列**靠左**（原位）、回合胶囊=中列**居中**（原位）—— 单独出现各归原位、同现同一行；\n"
    + "⛔ 两项必须显式 `grid-row: 1` —— 只指定列时 grid sparse 放置会把后放的第 1 列项顺延到第 2 行（10-11 用户截图实测：两胶囊各占一行）");
  ok(composer.includes("composer-status-zone") && composer.includes("composer-overlay-stack"),
    "询问/审批卡 = **临时覆盖层**（composer-overlay-stack absolute 盖在状态区上，关掉即露出）");
  ok(composer.indexOf("composer-status-row") < composer.indexOf("<QueuedMessageList"),
    "⛔ 排队消息渲染在两胶囊**下方**（正常流、不覆盖任何元素）");

  /* ── 10-27 用户令（截图）：「在运行过程中展示已编辑文件、已修改文件和已查看文件的文件名列表，
     所有文件名均使用高亮字体呈现，并支持点击交互：点击任一文件名后，右侧预览区联动显示对应文件
     的内容，同时保持当前预览状态与所选文件同步更新」。──────────────────────────────────
     ⛔ 归类口径必须在**纯函数**里（`lib/turn-file-actions.mjs`）：组件里再写一份正则 =
        两份真相源，只读文件迟早被漏掉。这里真跑真值表，不看字符串。 */
  {
    const { fileActionsOf } = await import(pathToFileURL(join(ROOT, "src/lib/turn-file-actions.mjs")).href);
    const items = [
      { type: "mcpToolCall", tool: "read_file", arguments: '{"path":"C:/w/src/a.tsx"}' },
      { type: "mcpToolCall", tool: "read_file", arguments: '{"path":"C:/w/src/a.tsx"}' },   // 去重
      { type: "commandExecution", command: 'cat C:/w/docs/spec.md' },                       // shell 读（unix）
      /* ⛔ 10-28 真机抓到的形态：Windows 上引擎的命令项是 Get-Content / Select-String，
         只认 cat/head/tail 的话「已查看」恒空 ⇒ 整个胶囊不渲染（用户看不到刚读过哪些文件）。 */
      { type: "commandExecution", command: 'Get-Content -LiteralPath "C:\\w\\src\\win-read.ts" -TotalCount 2' },
      { type: "commandExecution", command: 'Select-String -Path "C:\\w\\docs\\hit.md" -Pattern foo' },
      { type: "commandExecution", command: 'Set-Content -Path "C:\\w\\src\\win-write.ts" -Value hi' },
      { type: "mcpToolCall", tool: "edit_file", arguments: '{"file_path":"C:/w/src/b.ts"}' },
      { type: "commandExecution", command: "apply_patch <<'PATCH'\n*** Update File: C:/w/src/c.ts\nPATCH" },
      { type: "mcpToolCall", tool: "write_file", arguments: '{"path":"C:/w/src/new.json"}' },
      { type: "mcpToolCall", tool: "grep", arguments: '{"pattern":"x","path":"C:/w/node_modules/pkg/i.js"}' },
    ];
    const got = fileActionsOf({ items, liveChanges: [{ path: "C:/w/src/c.ts" }, { path: "C:/w/dist/out.js" }] });
    ok(got.read.length === 4 && got.read.every((row) => /a\.tsx|spec\.md|win-read\.ts|hit\.md/.test(row.path)),
      "已查看 = read_file / cat / Get-Content / Select-String 读到的文件（同文件只列一次；node_modules 下的噪音被跳过）");
    ok(!got.read.some((row) => /^type\s/i.test(row.name)),
      "⛔ 文件名不粘 shell 动词（`type package.json` 不能显示成「type package.json」）");
    /* ⛔ 10-28 真机：同一文件以「相对 + 绝对」两种写法各出现一次（列表里并排两行同名）；
       以及「从 1 加到 400」被当成文件 `1..400`。两者都是用户直接看到的脏数据。 */
    {
      const dedupe = fileActionsOf({ items: [
        { type: "commandExecution", command: `Get-Content -LiteralPath 'C:\\w\\src\\dup.ts'` },
        { type: "commandExecution", command: `type dup.ts` },
      ] });
      ok(dedupe.read.length === 1, "⛔ 相对/绝对两种写法的同一文件只列一次（保留更完整的路径）");
      const noise = fileActionsOf({ items: [{ type: "commandExecution", command: `Get-Content -TotalCount 2 'C:\\w\\a.md'` }] });
      ok(noise.read.length === 1, "数字区间（1..400）之类不是路径，别列进已查看");
    }
    ok(got.modified.some((row) => row.path.endsWith("win-write.ts")),
      "Set-Content（PowerShell 写入）归到「已修改」");
    ok(got.edited.length === 2 && got.edited.some((row) => row.path.endsWith("b.ts")) && got.edited.some((row) => row.path.endsWith("c.ts")),
      "已编辑 = edit_file 与 apply_patch（补丁式就地改）");
    ok(got.modified.length === 3 && got.modified.some((row) => row.path.endsWith("new.json"))
      && got.modified.some((row) => row.path.endsWith("dist/out.js"))
      && got.modified.some((row) => row.path.endsWith("win-write.ts")),
      "已修改 = write_file 新建 + Set-Content 写入 + 磁盘 live 扫描到的改动（工具项没抓到的子进程写入也不漏）");
    ok(!got.modified.some((row) => row.path.endsWith("c.ts")),
      "⛔ 已在「已编辑」里的文件不再重复进「已修改」（同一处改动只报一次）");
    const empty = fileActionsOf({ items: [] });
    ok(!empty.read.length && !empty.edited.length && !empty.modified.length, "空回合 ⇒ 三组都为空（不编造文件）");
  }
  ok(/const FILE_GROUPS: \{ key: keyof FileActions; label: string \}\[\] = \[\s*\{ key: "edited", label: "已编辑" \},\s*\{ key: "modified", label: "已修改" \},\s*\{ key: "read", label: "已查看" \}/.test(capsule),
    "胶囊按「已编辑 / 已修改 / 已查看」三组渲染（顺序与用户列举一致）");
  ok(/onClick=\{\(\) => openRightFile\(entry\.path\)\}/.test(capsule)
    && /from "\.\.\/\.\.\/lib\/right-file\.mjs"/.test(capsule),
    "点文件名 → openRightFile（既有右栏桥：补全路径 + 展开项目树 + 打开右栏并放宽）");
  ok(/subscribeRightFile\(\(\{ path \}: \{ path: string \}\) => setActivePath/.test(capsule)
    && /edited-files-row\$\{active \? " active" : ""\}/.test(capsule),
    "选中态订阅 right-file 广播 ⇒ 列表高亮项与右栏正在预览的文件始终同步");
  ok(/code\.edited-files-link \{ color: var\(--accent\)/.test(css) && /\.edited-files-row\.active \{/.test(css),
    "文件名用高亮色（--accent）+ 选中行有底色（用户：所有文件名均使用高亮字体呈现）");
  ok(/composer[\s\S]{0,400}turns=\{thread\.turns\}/.test(composer),
    "调用方把**本回合工具项**交给胶囊（只看磁盘改动的 live 扫描看不到「只读没改」的文件）");

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

/* ── 八、回合用量落账（10-11 用户报障：缓存输入输出/命中率只在重启后显示）──────────────
   根因：completedTurns/latestCompletedTurn 的 memo 键 threadMemoKey 原来只有
   「id:回合数:末 item id」—— 回合**完成瞬间三样都不变** ⇒ memo 陈旧，
   latestCompletedTurn 停在上一个回合 ⇒ 刚完成的回合拿不到 lastUsage/tokenUsage
   （时间线传 null）⇒ footer 的「N 入 / N 出 · N% 缓存」不显示；重启后引擎 thread
   载入自带 usage 才出现。⇒ 键必须含**末回合 status**（完成瞬间 running→completed 必变）。 */
console.log("\n【live-edits】⑱ 回合用量落账");
{
  const seg04 = codeOnly(read("src/features/app-state/parts/part04/01-seg.tsx"));
  ok(/\$\{bag\.thread\.turns\[bag\.thread\.turns\.length - 1\]\?\.status \?\? ""\}`/.test(seg04),
    "⛔ threadMemoKey 含**末回合 status**（⛔ 缺它 = 回合完成瞬间 memo 陈旧，用量页脚只在重启后出现）");
  ok(/\[bag\.threadMemoKey\]/.test(seg04),
    "completedTurns 确实以 threadMemoKey 为依赖（改键即生效）");
}

/* ── 九、提问卡「先选中、再确认」（10-11 用户：点击选项只是选中，提交按钮才生效）────────
   ⛔ 选项**不许**再点击即回（旧行为 resolve(option) 内联在 onClick 里）；单选/多选都走
   AgentAskCard 的选中态（role=radio/checkbox + aria-checked）+ 提交按钮；
   工具 schema 的 multiple 参数必须还在（单/多选由 Codex 决定的通道）。 */
console.log("\n【live-edits】⑲ 提问卡先选中再确认");
{
  const askCard = codeOnly(read("src/features/app-view/AppView/02-main-stage/03-composer/03-agent-ask-card.tsx"));
  ok(!/onClick=\{\(\) => \{ ask\.resolve\(option\)/.test(askCard),
    "⛔ 选项**不许**点击立即 resolve（旧行为：点一项就直接回给引擎，没有选中态）");
  ok(/role=\{multi \? "checkbox" : "radio"\}/.test(askCard) && /aria-checked=\{checked\}/.test(askCard),
    "选项带选中语义（role=radio/checkbox + aria-checked）与勾选视觉（.agent-ask-mark）");
  ok(/disabled=\{!canSubmit\}/.test(askCard) && /parts\.join\("；"\)/.test(askCard),
    "⛔ 提交按钮在「有选中或自定义输入」前禁用；答案 = 勾选 + 自定义输入拼接（单/多选同规则）");
  ok(/!multi && ask\.recommended \? \[ask\.recommended\]/.test(askCard),
    "单选**预选推荐项**（推荐路径保持一键确认，不因两步交互变麻烦）");
  const seg08 = codeOnly(read("src/features/app-state/parts/part08/01-seg.tsx"));
  ok(/name: "agent_ask"[\s\S]{0,600}multiple: \{ type: "boolean"/.test(seg08),
    "⛔ agent_ask 工具 schema 仍带 multiple 参数（单/多选由 Codex 决定的通道不许丢）");
  /* ⛔⛔ 10-11 实测定案：引擎的工具面**只在 spawn 时定死**（来源 = rollout 首行
     session_meta.dynamic_tools）—— thread/resume / thread/fork 里的 dynamicTools 被整份忽略
     （协议 schema 里 ThreadResumeParams 没有该字段；独立探针实测上游 tools 一个不多）。
     ⇒ 老会话升级工具面**只有**一条路：resume 前把 rollout 首行改成当前这一份。
     这条链断掉 = 创建于旧版本的会话永远看不见新工具（用户症状：agent_ask 写着"可多选"、
     界面只能选一个）。守卫钉三层：worker 实现 / 池导出 / resume 前的 await 调用点。 */
  const workerCode = read("electron/rollout-worker.cjs");
  ok(/function syncToolSurface\(/.test(workerCode) && /session_meta/.test(workerCode) && /payload\.dynamic_tools = tools/.test(workerCode),
    "⛔ rollout worker 有 syncToolSurface（改写首行 session_meta.dynamic_tools = 会话工具面）");
  ok(/renameSync\(tmpFile, file\)/.test(workerCode) && /tools\.bak/.test(workerCode),
    "⛔ 工具面改写走「临时文件 + rename 原子替换」且留 .bak 备份（⛔ 直接覆盖写会在被杀时留下半截 JSONL = 历史损坏）");
  const poolCode = codeOnly(read("electron/rollout-pool.ts"));
  ok(/export function syncToolSurfaceAsync\(/.test(poolCode) && /call\("syncTools"/.test(poolCode),
    "rollout-pool 暴露 syncToolSurfaceAsync（传到 worker 的 syncTools op）");
  const ipcCode = codeOnly(read("electron/features/codex-ipc.ts"));
  /* 10-21 工具面带 `step` 参数后，第三个实参是 withStepParam(resumeTools)；判据盯「resume 之前 await」与「最终工具面」两点。 */
  ok(/method === "thread\/resume"[\s\S]{0,1200}await syncToolSurfaceAsync\(codexHome, resumeThreadId, (?:withStepParam\(resumeTools\)(?:\s+as\s+[^,)]+)?|resumeTools)\)/.test(ipcCode),
    "⛔ codex-ipc 在 thread/resume **之前** await 工具面同步（引擎就是在这条 resume 上 spawn 会话并读首行；晚一步就白做）");
  ok(/multiple === true \|\| args\.multiple === "true"/.test(codeOnly(read("src/features/app-state/parts/part05/event-router/02-request.tsx"))),
    "agent_ask 的 multiple 解析容错字符串 \"true\"（个别模型会传字符串）");

  /* ⛔⛔ 10-31 用户令（两次点名 + WorkBuddy 对照截图）：「排队/插队消息发出去后，
     后续 codex 消息要在我这条消息下面」。插队分段渲染 = 回合内多条用户消息按**流中顺序**切段，
     ⛔ 不许再把所有用户气泡搬到卡片顶上。
     ⛔⛔ 门判必须是「**回合里有 ≥2 条普通用户消息**」，⛔ 不能写成「首条用户消息之前已有响应项」——
     真实 rollout 是 `USER1 → tool → tool → USER2 → tool → answer`（回合以用户消息开头）
     ⇒ 那样写门判恒 false、分段永远不跑，用户看到的就是"我的消息跳上去、后续内容堆在上面"（上一版就栽在这）。 */
  ok(/splitFlowSegments\(turn\.items/.test(turnView) && /const interleaved = shouldFlowSegment\(flowSegments\)/.test(turnView) && /shouldFlowSegment/.test(read("src/lib/turn-flow-segments.mjs")),
    "插队分段：门判 = 回合内 ≥2 条普通用户消息（⛔ 不是「首条用户消息前有响应项」，那个判据在真实数据上恒假）");
  ok(/flowSegments\.map\(\(seg, index\) => \{[\s\S]{0,400}?MemoUserMessageView item=\{seg\.user\}/.test(turnView),
    "插队分段：用户气泡渲染在自己的流位置上（段内 MemoUserMessageView）");
  ok(/const headSegIndex = headSegmentIndex\(flowSegments\)/.test(turnView)
    && /index === headSegIndex && userItems\.length > 0/.test(turnView) && !/index === 0 && userItems/.test(turnView),
    "插队分段：头像/「正在处理 N 秒」挂在**首段实块**（回合以用户消息开头时首段是空段，写死 index===0 会整轮没头像）");
  ok(/finalAgentId=\{last \? finalAgent\?\.id : undefined\}/.test(turnView) && /completedSkin=\{last\}/.test(turnView),
    "插队分段：只有最后一段带最终答复/收尾皮肤（耗时属于整个回合，⛔ 段段都挂就是同屏多个）");
  const queueStream = codeOnly(read("src/features/session-queue/SessionQueue.tsx"));
  ok(/completedSkin = true/.test(queueStream) && /leadFoldIndex && completedSkin \? "completed" : "summary"/.test(queueStream),
    "TurnFoldStream 支持 completedSkin（非末段不挂回合收尾皮肤）");

  /* ⛔⛔ 10-31 用户令：「调度得专家，显示那个弹窗输出内容，输出完成，弹窗不会自动隐藏」
     ⇒ 两个调度弹窗跑完自动收（running→done 那一刻留 1.6s），failed 不关、翻历史也不关。 */
  const timelineSrc = codeOnly(read("src/features/app-view/AppView/02-main-stage/01-timeline.tsx"));
  ok(/popupCloseRef/.test(timelineSrc)
    && /prev\.id !== id \|\| prev\.status !== "running" \|\| status !== "done"/.test(timelineSrc)
    && /setTimeout\(\(\) => setDelegatedPopupId\(""\), 1600\)/.test(timelineSrc)
    && /setTimeout\(\(\) => setTeamPopupRunId\(""\), 1600\)/.test(timelineSrc),
    "调度弹窗输出完成自动隐藏（专家团成员 + 普通调度两处；⛔ 只在 running→done 那一刻关，failed/翻历史不关）");

  /* ⛔⛔ 10-31 用户令：「主会话向被调度的子会话发送消息时，不能以用户视角显示在右侧头像位置，
     必须同样显示在左侧，并以主会话自身的身份发出」。
     ⇒ `[SYSTEM TASK · 调度会话]` 那种壳（delegation 主进程拼的）走**左对齐的上级气泡**；
     ⛔ 成员/团队会话的壳可能是用户自己打字（send.tsx 那条路），不能左移 —— 会把用户的话伪造成上级发言。 */
  const umv = codeOnly(read("src/features/shared/UserMessageView.tsx"));
  ok(/const isParentTask = refs\.teamTask\?\.label === "调度会话"/.test(umv)
    && /<div className="parent-task-stack"/.test(umv)
    && /parent-task-name/.test(umv),
    "调度任务在子会话里以「主会话」身份左对齐渲染（⛔ 只认 调度会话 壳，成员/团队壳不动）");
  const msgCss = read("src/styles/03-messages-turns.css");
  ok(/\.parent-task-stack\s*\{[\s\S]{0,200}?align-items: flex-start/.test(msgCss) && /\.parent-task-body\s*\{/.test(msgCss),
    "上级任务气泡的样式在位（左对齐 + 左侧强调线；⛔ 只加类不写样式 = 还是贴在右侧）");

  /* ⛔⛔ 10-31 用户令：会话笔名体系（两字笔名 / 主管职级 / 上级联动）——
     行为断言优先：拿名字库真跑，不看正则形状。⛔ 本文件用 ok(cond, msg) 形态（没有 fail）。 */
  const names = await import("../../src/lib/session-names.mjs");
  ok(Array.isArray(names.ALIAS_POOL) && names.ALIAS_POOL.length >= 200,
    `笔名池 ≥200（实得 ${names.ALIAS_POOL?.length ?? 0}）—— 用户要求「200 个会话不能有重复名字」`);
  ok(new Set(names.ALIAS_POOL).size === names.ALIAS_POOL.length, "笔名池自身无重复");
  ok(names.ALIAS_POOL.every((alias) => /^[\u4e00-\u9fa5]{2}$/.test(alias)), "每个笔名都是**两个字**中文");
  ok(names.ALIAS_POOL.slice(0, 50).every((alias) => names.aliasMeaningOf(alias).length > 0),
    "每个名字都有寓意（首字 + 尾字各一句，⛔ 不能是空串）");
  const picked = new Set();
  for (let i = 0; i < 200; i += 1) picked.add(names.pickSessionAlias(`thread-${i}`, picked));
  ok(picked.size === 200 && !picked.has(""), `连续分配 200 个会话拿到 200 个互不重名的笔名（实得 ${picked.size}）`);
  ok(names.pickSessionAlias("same-thread", []) === names.pickSessionAlias("same-thread", []), "同一会话重复取值稳定（确定性选取，重开不变）");
  /* ⛔ 断言的是**行为**（被占用的名字绝不会选中、且仍然确定），不是"下一个元素是谁" ——
     选取是"哈希起步 + 顺延"，起步点不一定是池头。 */
  const taken5 = names.ALIAS_POOL.slice(0, 5);
  const afterSkip = names.pickSessionAlias("x", taken5);
  ok(afterSkip && !taken5.includes(afterSkip) && afterSkip === names.pickSessionAlias("x", taken5),
    "名字被占用时顺延探测（⛔ 不会撞名，且结果仍然确定）");
  ok(names.supervisorIdOf("青崖") === "青崖主管" && names.supervisorIdOf("") === "",
    "主会话 ID = 笔名 +「主管」；空笔名不造出孤零零的「主管」");
  ok(names.USER_TITLE === "总经理", "用户职级 = 总经理");
  ok(names.validateAlias("青", []).ok === false && names.validateAlias("abc", []).ok === false && names.validateAlias("青崖", ["青崖"]).ok === false,
    "改名校验：必须两字中文、且不与别人重名");

  /* 接线：新建会话自动分配 / 子会话带上级 / 改名广播 / 侧栏可改 */
  const aliasIpc = read("electron/features/session-alias-ipc.ts");
  ok(/session-alias:snapshot/.test(aliasIpc) && /session-alias:set/.test(aliasIpc) && /session-alias:ensure/.test(aliasIpc),
    "笔名三通道齐（快照 / 改名 / 新建自动分配）");
  const codexIpcSrc = read("electron/features/codex-ipc.ts");
  ok(/ensureSessionAlias\(String\(r\.thread\.id\)\)/.test(codexIpcSrc),
    "新建会话自动取笔名（thread/start 回执处，⛔ 靠 UI 触发就会漏后台建会话）");
  const delegationSrc = read("electron/features/delegation.ts");
  ok(/ensureSessionAlias\(threadId, origin\)/.test(delegationSrc) && /supervisor: supervisorLabel/.test(delegationSrc),
    "调度的子会话：笔名 + 上级（写进持久指令 delegateScopeBlock）");
  ok(/上级主管：\$\{supervisorLabel\}/.test(delegationSrc),
    "调度的首任务带「上级主管：XX主管」（会话视图据此显示上级身份）");
  const teamInvokeSrc = read("electron/team-invoke.ts");
  ok(/ensureSessionAlias\(memberThreadId, String\(input\.leadThreadId/.test(teamInvokeSrc) && /上级主管：\$\{memberSupervisor\}/.test(teamInvokeSrc),
    "专家团成员会话同样带上级（主理人会话）");
  ok(/setSessionAliasEmitter\(/.test(read("electron/features/boot.ts")),
    "改名后广播（⛔ 不广播 = 改完主管名，子会话还显示旧名字）");
  const rowSrc = read("src/features/app-state/parts/part02/02-goal-browser-notice/01-goal-review-file-browser/02-thread-attention-rows.tsx");
  ok(/thread-alias-badge/.test(rowSrc) && /改笔名/.test(rowSrc) && /sessionAliasSet/.test(rowSrc),
    "侧栏显示笔名 + 菜单可改（改完用返回的 snapshot 立刻刷新）");
  ok(/subscribeAliases/.test(read("src/features/shared/UserMessageView.tsx")),
    "上级气泡订阅笔名快照（父会话改名 ⇒ 子会话这里当场变）");
}

console.log(`\n【live-edits】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
