/**
 * 12ay —— 插队消息「待并入 · 可撤回」（11-05 用户令）
 *
 * 用户口径原话：
 *   ①「只有在运行过程中，模型还在处理个消息的时候，可以撤，一旦模型开始处理插队消息后，就不能撤回了」
 *   ②「插队消息发出去，可以撤回的时候，在用户消息下面加一个可以撤回图标，不能撤回[的时候]自己就不显示了」
 *
 * ⛔ 为什么必须**延迟派发**：引擎的 `turn/steer` 收到后没有任何撤回接口
 *   （协议里只有 turn/steer / turn/interrupt —— 后者杀整个回合，不是撤这条输入）。
 *   要"能撤"，唯一诚实的做法是点「立即」时**先不交给引擎**：条目留在引擎队列里、
 *   以用户消息的形态挂在对话末尾并带一枚「撤回」图标，等当前这一步跑完再真正 steer。
 *   交出去**之前**就把气泡摘掉（`settlePendingSteers`）：引擎回声会把这条画在当前回合里，
 *   气泡留着 = 同一句话在界面上出现两遍（10-31 定案的同款缺陷，本轮审查又抓了一次）。
 *
 * 判据两半：纯函数**真跑**（登记表两态语义 + 撤回窗口 + 边界判定真值表 + getSnapshot 引用稳定）
 * 与接线**结构**（steer 分支改成登记、派发 effect、撤回先撤销再删、气泡挂位与图标两态、面板去重、
 * ⛔ 「steer 撞上 no active turn」这条退化路**不许删队列条目**且必须落到 thread/queue/start）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/[^'"`]*$/, "")).join("\n");

let checks = 0;
let fails = 0;
const ok = (cond, msg) => { checks += 1; console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails += 1; };

console.log("【12ay】插队消息待并入 · 可撤回");

/* ── ① 登记表两态语义（真跑）───────────────────────────────────────────────── */
const store = await import(pathToFileURL(join(ROOT, "src/lib/pending-steer.mjs")).href);
const T = "thread-A";
let notified = 0;
const offListener = store.subscribePendingSteers(() => { notified += 1; });

ok(store.armPendingSteer({ threadId: "", id: "x", entry: { input: [] } }) === false
  && store.armPendingSteer({ threadId: T, id: "", entry: { input: [] } }) === false
  && store.hasPendingSteers(T) === false,
  "缺 threadId / id 的登记被拒且不落库（漏判会让下一条永远挂着「可撤回」图标）");

const q1 = { id: "q1", input: [{ type: "text", text: "一" }] };
const q2 = { id: "q2", input: [{ type: "text", text: "二" }] };
const armedAt = notified;
ok(store.armPendingSteer({ threadId: T, id: "q1", entry: q1 }) === true
  && store.armPendingSteer({ threadId: T, id: "q2", entry: q2 }) === true
  && store.isPendingSteer(T, "q1") === true
  && store.pendingSteerIds(T).join(",") === "q1,q2"
  && store.hasPendingSteers(T) === true
  && notified > armedAt,
  "登记后读取面都认、按登记顺序返回，并且**广播了订阅**（不广播 ⇒ 界面上的气泡与撤回图标不会当场出现）");

/* getSnapshot 引用稳定：useSyncExternalStore 每次拿到新数组就无限重渲染（React 直接卡死） */
const snapA = store.pendingSteerSnapshot(T);
ok(snapA === store.pendingSteerSnapshot(T) && snapA.length === 2,
  "快照引用稳定：连续两次 getSnapshot 返回**同一个数组**（⛔ 每次新建 = useSyncExternalStore 无限重渲染）");
store.armPendingSteer({ threadId: T, id: "q3", entry: { id: "q3" } });
ok(store.pendingSteerSnapshot(T) !== snapA && store.pendingSteerSnapshot(T).length === 3,
  "登记表变了 ⇒ 快照必须换新（引用不变 = React 认为没变化，撤回图标永远不刷新）");
store.cancelPendingSteer(T, "q3");

ok(store.cancelPendingSteer(T, "q1") === true
  && store.isPendingSteer(T, "q1") === false
  && store.isPendingSteer(T, "q2") === true,
  "撤回只撤这一条：同会话另一条仍可撤（误清会把用户没撤的消息一起吞掉）");

ok(store.cancelPendingSteer(T, "q1") === false
  && store.cancelPendingSteer(T, "不存在") === false
  && store.cancelPendingSteer("thread-B", "q2") === false
  && store.pendingSteerIds("thread-B").length === 0,
  "重复撤回 / 未知 id / 未知会话都是幂等 false，不抛错");

const taken = store.takePendingSteers(T);
ok(taken.length === 1 && taken[0].id === "q2" && taken[0].input[0].text === "二",
  "take 交还**队列条目本体**（派发要用它的 input / clientUserMessageId）");
ok(store.hasPendingSteers(T) === false && store.pendingSteerIds(T).length === 0
  && store.pendingSteerVisibleIds(T).join(",") === "q2",
  "take 后条目转为 sending：不再是「可撤回」（撤回图标当场消失），但仍在可见快照里，等调用方 settle 才摘");
ok(store.cancelPendingSteer(T, "q2") === false && store.pendingSteerVisibleIds(T).includes("q2"),
  "sending 态撤回不动它 —— 已经交给引擎了，界面不给「撤回」入口才是诚实的");

store.settlePendingSteers(T, ["q2"]);
ok(store.pendingSteerVisibleIds(T).length === 0 && store.pendingSteerSnapshot(T).length === 0,
  "交付落定 ⇒ 摘掉气泡（引擎回声从这一刻起接管原位渲染）");
store.settlePendingSteers(T, ["q2"]);
ok(true, "settle 幂等：重复摘不抛错");

store.armPendingSteer({ threadId: T, id: "q9", entry: { id: "q9" } });
store.takePendingSteers(T);
ok(store.pendingSteerIds(T).length === 0 && store.armPendingSteer({ threadId: T, id: "q9", entry: { id: "q9" } }) === true
  && store.pendingSteerIds(T).join(",") === "q9",
  "重新登记把 sending 退回 armed（用户切走时不盲发、等切回来再派发的路径依赖这一条）");
store.cancelPendingSteer(T, "q9");
ok(store.hasPendingSteers(T) === false, "撤掉最后一条后会话键一并回收（不留空 Map）");

ok(Array.isArray(store.takePendingSteers("thread-C")) && store.takePendingSteers("thread-C").length === 0,
  "空会话 take 返回空数组（返回 undefined 会让派发方在 .length 上抛）");
offListener();

/* ── ② 派发边界真值表（真跑）──────────────────────────────────────────────────── */
ok(store.turnStepBusy({ items: [] }) === true,
  "回合刚起、一步都还没有 ⇒ 算「在忙」（否则可撤回窗口宽度为 0，点完立即下一帧就派发）");
ok(store.turnStepBusy({ items: [{ status: "completed" }, { status: "inProgress" }] }) === true,
  "任一项 inProgress ⇒ 在忙（不派）");
ok(store.turnStepBusy({ items: [{ status: "completed" }, { status: "running" }] }) === true,
  "任一项 running ⇒ 在忙（口径与 isTurnRunning 同源）");
ok(store.turnStepBusy({ items: [{ status: "completed" }, {}] }) === true,
  "最后一项没有 status 也没有 durationMs ⇒ 在忙（流式 item 先建后补状态，漏判会抢跑）");
ok(store.turnStepBusy({ items: [{ status: "completed" }, { status: "completed", durationMs: 12 }] }) === false
  && store.turnStepBusy({ items: [{ status: "completed" }, { durationMs: 5 }] }) === false,
  "全部落定 ⇒ 边界到达（这时才真正 steer / 启动）；已完成项缺 status 但有 durationMs 不误判为忙");
ok(store.turnStepBusy({ items: [{ durationMs: 3 }, { status: "completed" }] }) === false,
  "没有 status 但**不是最后一项** ⇒ 不算忙（只有尾巴那一条才按流式在写算）");
ok(store.turnStepBusy({ items: [{ status: "inProgress" }, { status: "completed" }] }) === true,
  "中间步还在跑 ⇒ 在忙（尾巴完成了不代表回合没在跑下一步）");
ok(store.turnStepBusy(undefined) === true && store.turnStepBusy(null) === true,
  "空回合按「在忙」处理（拿不到 items 不派发，宁可等下一条事件）");

/* ── ③ 接线（结构）───────────────────────────────────────────────────────────── */
const partPath = "src/features/app-state/parts/part04/03-seg/02-browser-queue-settings.tsx";
const partSrc = stripComments(read(partPath));

// 「立即」的 steer 分支 = 从 `if (steerTurnId && entry) {` 到紧随其后的 `const armedForStart`
const steerBranchFrom = partSrc.indexOf('if (steerTurnId && entry) {');
const steerBranch = steerBranchFrom < 0 ? "" : partSrc.slice(steerBranchFrom, partSrc.indexOf("const armedForStart", steerBranchFrom));
ok(steerBranch.length > 0
  && /armPendingSteer\(\{ threadId: bag\.thread\.id, id: entry\.id, entry \}\)/.test(steerBranch)
  && !/turn\/steer/.test(steerBranch),
  "运行中点「立即」⇒ 只登记待并入，**不直接 turn/steer**（交了引擎就撤不回，这是整条设计的命门）");
ok(/bag\.refreshQueue\(bag\.thread\.id\)/.test(steerBranch)
  && /showToast\("已插队 · 可撤回"/.test(steerBranch)
  && /return;/.test(steerBranch),
  "登记后刷新队列 + 提示「已插队 · 可撤回」并 return（不启动回合、不钉顶、不动乐观气泡）");

ok(/useEffect\(\(\) => \{[^}]*hasPendingSteers\(threadId\)[^}]*isTurnRunning\(turn\)[^}]*turnStepBusy\(running\)[^}]*deliverPendingSteers\(bag, threadId\)[^}]*\}, \[bag\.thread, bag\.queue\]\)/.test(partSrc),
  "派发 effect 齐备：没登记就早退 → 有运行中回合且这一步在忙就再等 → 边界上派发；依赖 [thread, queue]（流式与队列事件都推它重跑）");

ok(/if \(isCurrent\(\) && !bag\.queue\.some\(\(queued\) => queued\.id === entry\.id\)\) continue;/.test(partSrc),
  "派发前逐条复核「还在队列里」：用户已撤回 / 引擎已自动启动 ⇒ 跳过，绝不重复发");

const deleteFrom = partSrc.indexOf("async function deleteQueued");
const deleteBlock = deleteFrom < 0 ? "" : partSrc.slice(deleteFrom, partSrc.indexOf("bag.deleteQueued", deleteFrom));
ok(deleteBlock.indexOf("cancelPendingSteer(bag.thread.id, id)") >= 0
  && deleteBlock.indexOf("cancelPendingSteer(bag.thread.id, id)") < deleteBlock.indexOf('thread/queue/delete'),
  "撤回：先撤销待并入登记、再发 thread/queue/delete（顺序反了会出现「界面删了、稍后又被发出去」）");

const deliverFrom = partSrc.indexOf("async function deliverPendingSteers");
const deliverBlock = deliverFrom < 0 ? "" : partSrc.slice(deliverFrom, partSrc.indexOf("function deliverAutoContinue", deliverFrom));
ok(/takePendingSteers\(threadId\)/.test(deliverBlock)
  && /turn\/steer/.test(deliverBlock)
  && /expectedTurnId: runningTurn\.id/.test(deliverBlock)
  && /thread\/queue\/start/.test(deliverBlock),
  "派发实现两条落点齐全：回合还在跑 ⇒ steer 并入当前回合；回合已结束 ⇒ 按新回合启动（与排队消息 auto-start 同语义）");
ok(/armPinForReleasedQueue\(threadId, "steer"\)/.test(deliverBlock)
  && /markThreadStopped\(threadId\)/.test(deliverBlock),
  "派发沿用既有钉顶意图与「no active turn」陈旧态处理（不撤钉顶意图，与原「立即」一致）");

/* ⛔ 审查抓到的静默丢消息：steer 撞上 no active turn 时这条**根本没发出去**，
   若照旧走 thread/queue/delete 就是"队列删了、模型没收到、界面还说已并入"。
   判据落在代码形态上：delete 只允许出现在 `if (steered)` 里，且退化路必须能走到 queue/start。 */
const steeredAt = deliverBlock.indexOf("if (steered) {");
const deleteAt = deliverBlock.indexOf("thread/queue/delete");
const startAt = deliverBlock.indexOf("thread/queue/start");
ok(steeredAt > 0 && deleteAt > steeredAt && startAt > steeredAt
  && /if \(steered\) \{[\s\S]{0,700}?\bcontinue;\s*\}/.test(deliverBlock)
  && /steer-stale-fallback/.test(deliverBlock.slice(deliverBlock.indexOf("catch (error)"), steeredAt)),
  "steer 失败（no active turn）⇒ 不删队列条目、不清定时，退化到 thread/queue/start 按新回合发出去（删了就是静默丢消息）");

/* ⛔ 一批两条时，第一条派发完上一回合可能刚好结束 ⇒ 运行中回合必须**逐条**重算。
   锚点用带 `{` 的主循环（前面还有一行式的 `for (...) armPendingSteer(...)`，不带花括号）。 */
ok(deliverBlock.indexOf("for (const entry of entries) {") < deliverBlock.indexOf("const runningTurn = (bag.threadRef.current?.turns ?? [])")
  && deliverBlock.indexOf("const runningTurn = (bag.threadRef.current?.turns ?? [])") < deliverBlock.indexOf("if (steered) {"),
  "运行中回合在循环**体内**逐条重算（写在循环外 = 第二条永远拿陈旧回合 id 去 steer，必然 no active turn）");

const timerRevokes = [...deliverBlock.matchAll(/setQueuedTimer\(threadId, entry\.id, null, \{ silent: true \}\)/g)];
ok(timerRevokes.length === 2,
  `派发两条落点都撤销这条的定时（各 1 处，实测 ${timerRevokes.length}）—— 消息都发出去了还留着主进程定时器，到点会对一个不存在的队列条目广播 due`);
ok(/armPinForReleasedQueue\(threadId, "steer"\);\s*\r?\n\s*settlePendingSteers\(threadId, \[entry\.id\]\);\s*\r?\n\s*try \{/.test(deliverBlock)
  && /const armedForStart = bag\.armPinForReleasedQueue/.test(deliverBlock)
  && /settlePendingSteers\(threadId, \[entry\.id\]\);\s*\r?\n\s*if \(armedForStart\)/.test(deliverBlock)
  && /finally \{[\s\S]{0,200}?settlePendingSteers\(threadId, \[entry\.id\]\)/.test(deliverBlock),
  "交出去之前先摘气泡（两条落点都先 settle）：引擎回声会把这条画在当前回合里，气泡留着就是同一句显示两遍；finally 再兜一次底，任何提前 continue / 抛错都不许把条目卡在 sending");
ok(/if \(armedForStart\) \{[\s\S]{0,200}?showQueuedOptimistic\(bag, entry\.input\)/.test(deliverBlock)
  && /disarmPinIntent\("queue-start-fail"\)/.test(deliverBlock)
  && /if \(isCurrent\(\)\) \{\s*\r?\n\s*if \(armedForStart\) bag\.setOptimisticInput\(null\);/.test(deliverBlock),
  "新回合落点照搬原「立即」的配套：意图建立成功才上乐观气泡，失败把意图与气泡一起撤 —— 且清气泡必须在 `isCurrent()` 里（optimisticInput 是全局一个槽，切走后清会把新会话那条一起抹掉）");

ok(/if \(!isCurrent\(\)\) \{[\s\S]{0,160}?armPendingSteer\(\{ threadId, id: entry\.id, entry \}\)[\s\S]{0,80}?return;/.test(deliverBlock),
  "派发时用户已切走 ⇒ 不盲发，重新登记等切回来再判边界（回合数据只存当前会话，拿不到活动回合硬发只会撞引擎）");

/* ── ④ 对话里的「待并入」气泡 + 撤回图标 ──────────────────────────────────────── */
const bubbleSrc = stripComments(read("src/features/session-queue/PendingSteerBubbles.tsx"));
ok(/usePendingSteerEntries\(threadId\)/.test(bubbleSrc) && /const retractable = pendingSteerIds\(threadId\)/.test(bubbleSrc),
  "气泡订阅登记表快照 + 顶层读 armed 名单（⛔ hook 写进 map/回调 = React #310 白屏，两条都在组件第一层）");
ok(/type: "userMessage"/.test(bubbleSrc) && /<ItemView item=\{\{/.test(bubbleSrc),
  "用真实用户消息那套渲染（ItemView 的 userMessage 分支），不是另造一个芯片");
ok(/canWithdraw && \(\s*<button[^>]*className="pending-steer-withdraw"/.test(bubbleSrc)
  && /data-pending-steer=\{canWithdraw \? "armed" : "sending"\}/.test(bubbleSrc),
  "「撤回」图标**只在 armed 态渲染** ⇒ sending 起它自己消失（用户要的「不能撤回就不显示」）");
ok(bubbleSrc.indexOf("pending-steer-withdraw") < bubbleSrc.indexOf("<ItemView"),
  "图标排在**这条用户消息前面**（11-05 用户实测「丑死了，不会放用户消息前面吗」——挂在气泡下面被否掉）");
ok(/onWithdraw\(id\)/.test(bubbleSrc) && !/window\.codex/.test(bubbleSrc),
  "图标只做一件事：回调给宿主走 deleteQueued（气泡自己不许直连 IPC，否则撤回与排队面板两条实现会分岔）");

const timelineSrc = stripComments(read("src/features/app-view/AppView/02-main-stage/01-timeline.tsx"));
const bubbleAt = timelineSrc.indexOf("<PendingSteerBubbles");
ok(bubbleAt > 0
  && bubbleAt > timelineSrc.indexOf("{optimisticInput && !optimisticConfirmed && <>")
  && /onWithdraw=\{\(id\) => void app\.deleteQueued\(id\)\}/.test(timelineSrc),
  "气泡挂在消息流末尾（乐观气泡之后），撤回走 app.deleteQueued（与排队面板同一实现）");
const barAt = timelineSrc.indexOf('<div className="run-activity-bar"');
ok(barAt > bubbleAt,
  "状态条仍排在插队气泡**之后**（09-17 定案：消息 → 状态条，别让状态条压在用户消息上面）");

const queueSrc = stripComments(read("src/features/session-queue/SessionQueue.tsx"));
ok(/const listed = pendingIds && pendingIds\.length \? entries\.filter\(\(entry\) => !pendingIds\.includes\(entry\.id\)\) : entries;/.test(queueSrc)
  && /if \(!listed\.length\) return null;/.test(queueSrc)
  && /const n = listed\.length;/.test(queueSrc),
  "排队面板按 pendingIds **过滤掉**已点立即的条目（同一条消息不在对话和面板各挂一份），折叠计数与序号都用过滤后的数组");
ok(!/queued-badge-pending/.test(queueSrc) && !/\{pending \? "撤回" : "删除"\}/.test(queueSrc),
  "面板里的「待并入徽标 / 撤回按钮」两态已退役（入口搬到了对话里的气泡下面，留着就是同一功能两个位置）");

const composerSrc = read("src/features/app-view/AppView/02-main-stage/03-composer.tsx");
ok(/import \{ usePendingSteerVisibleIds \} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/pending-steer\.mjs"/.test(composerSrc)
  && /const pendingSteerHide = usePendingSteerVisibleIds\(String\(thread\?\.id \?\? ""\)\);/.test(composerSrc)
  && /pendingIds=\{pendingSteerHide\}/.test(composerSrc),
  "面板的隐藏名单走**订阅版** hook（直接调函数会比对话里的bubble慢一拍 ⇒ 同一条消息在面板和对话里各出现一次）");

/* ── ⑤ 样式与负向 ─────────────────────────────────────────────────────────────── */
const css = read("src/styles/15-queued-messages.css");
ok(/\.pending-steer-stack \{[^}]*flex-direction: column/.test(css)
  && /\.pending-steer-withdraw \{/.test(css)
  && /\.pending-steer-item \{[^}]*align-items: flex-end/.test(css),
  "气泡与撤回图标有专属样式且与用户消息同侧右对齐（TSX 用到的类必须在 CSS 里存在，否则【66】覆盖率告警）");
ok(!/pending-steer-item\[data-pending-steer="armed"\][^{]*outline/.test(css),
  "⛔ 不给消息本体描虚线框（11-05 用户实测「丑死了」——空荡荡一个大虚线框）");

const libSrc = stripComments(read("src/lib/pending-steer.mjs"));
ok(!/localStorage|writeFileSync|readFileSync/.test(libSrc),
  "登记表不落盘（排队消息本身就在引擎内存里，重启后消息没了、登记更不能留着 —— 生命周期必须一致）");
ok(/function dropThread\(key\) \{[\s\S]{0,120}?pending\.delete\(key\);[\s\S]{0,60}?snapshots\.delete\(key\);/.test(libSrc)
  && /if \(!map\.size\) dropThread\(/.test(libSrc),
  "会话空了把两份表一起摘掉（登记表 + 快照缓存）：⛔ 只摘一份的话，切走/删掉的会话会在模块级 Map 里一直攒");
const bagTypes = stripComments(read("src/features/app-state/parts/bag-types.ts"));
ok(!/pendingSteer|armPendingSteer|turnStepBusy/.test(bagTypes),
  "辅助函数留在模块级、没被 bag-types 收进 bag（hook 体顶层声明会被生成器当跨段 API）");

console.log(fails ? `\n【pending-steer】失败 ${fails} 项` : `\n【pending-steer】通过 ${checks} 项`);
process.exit(fails ? 1 : 0);
