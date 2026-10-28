/** 07-turn-fold 第 3/6 段：原 07-turn-fold.mjs L1797–L2694（逐字搬运 + 各自成块）。
 *  ⛔ 每个顶层语句外面套一层块：拆段后同一文件里不再共享作用域，const 重名不会撞（也正好还原原文件的分块隔离）。 */
/**
 * 预检守卫组：07-turn-fold
 * 分节：【43】（原 L4094–L7963）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  AUTO_CONTINUE_MAX_ATTEMPTS, C, MOOD_HEADING, ROOT, TRUNCATE_OUTPUT_MAX_CHARS, TRUNCATE_REASONING_MIN_CHARS, applyMoodSignal, codeOnly, composeMoodInstructions, createHash, createRequire, decayMood, emptyMood, existsSync, fail, homedir, isTruncatedEmptyTurn, join, mainSrc, moodBlock, moodSignature, moodTone, normalizeMood, ok, pathToFileURL, preloadSrc, readAppUi, readBuiltinSkillsSource, readFileSync, readMainSource, readResponsesBridgeSource, readStyles, readVoiceSettingsSrc, readdirSync, relative, spawnSync, statSync, turnOutputStats, walk, warn,
} from "../_ctx.mjs";
import { isQueueAlreadyStartedError } from "../../../src/lib/queue-errors.mjs";
import { splitMarkdown, trimInvisibleSpace } from "../../../src/lib/markdown-blocks.mjs";



export async function run() {
{
{
  const srv = readFileSync(join(ROOT, "electron", "codex-server.ts"), "utf8");
  const main = readMainSource();
  const pre = readFileSync(join(ROOT, "electron", "preload.ts"), "utf8");
  const appSrc52 = readAppUi();
  const viteEnv = readFileSync(join(ROOT, "src", "vite-env.d.ts"), "utf8");

  // ① 闸门本体：restart 默认不在忙时真重启
  (/async restart\(opts: \{ reason\?: string; force\?: boolean \} = \{\}\)/.test(srv)
    ? ok : fail)("【52】restart 接受 reason/force 参数（可区分「谁触发的」与「必须立刻」）");
  (/if \(busy && !opts\.force\) \{/.test(srv) ? ok : fail)("【52】忙时默认推迟（不打断在跑的任务）");
  (/this\.deferredRestart = \{ reason \};/.test(srv) ? ok : fail)("【52】推迟的请求被记下来（等空闲补做）");
  (/async flushDeferredRestart\(\)/.test(srv) ? ok : fail)("【52】有空闲后补做推迟重启的入口");
  (/setBusyGate\(fn: \(\) => number\)/.test(srv)
    ? ok : fail)("【52】可注入「有几个回合在跑」的判定（返回数量，不返回布尔 —— 台账要能看出真实计数）");
  (/activeTurnCount\(\) \{/.test(srv) ? ok : fail)("【52】对外暴露活跃回合数（验收探针 + 台账共用）");

  // ② 两条"必须立刻"的路径 —— 漏了这两处 force，闸门会变成"永远不重启"（比打断更糟）
  (/restart\(\{ force: true, reason: "engine-exited" \}\)/.test(srv)
    ? ok : fail)("【52】引擎已退出时 force 重启（否则等不到空闲 = 永不恢复）");
  (/restart\(\{ force: true, reason: "heartbeat-timeout" \}\)/.test(srv)
    ? ok : fail)("【52】心跳卡死时 force 重启（卡死时不会有 turn/completed，等下去等于不恢复）");

  // ③ 主进程接线：用引擎侧真实记账做判定（不依赖渲染层上报）
  (/server\.setBusyGate\(\(\) => engineActiveTurnIds\.size\)/.test(main)
    ? ok : fail)("【52】主进程注入真实记账（engineActiveTurnIds）作为判定");
  (/if \(engineActiveTurnIds\.size === 0\) void server\.flushDeferredRestart\(\)/.test(main)
    ? ok : fail)("【52】最后一个回合结束时补做推迟的重启（否则配置永不生效）");
  // ⛔ 记账必须是 Map（turnId → threadId）：用裸 Set 时「A 会话跑完」会把 B 会话的记录一起清掉
  //    → 闸门误判为空闲 → 直接打断 B（比不修还糟）。这条是 09-19 设计审计抓出来的。
  (/const engineActiveTurnIds = new Map<string, string>\(\);/.test(main)
    ? ok : fail)("【52】记账用 Map 而不是 Set（否则一个会话结束会误清掉别的会话）");
  // ⛔ 记账必须宽容：只认 `params.turn.id` 会漏掉 `turnId` 形态的引擎版本 → 记账恒空 →
  //    闸门形同虚设（09-19 首轮验收就是 busy=false 假成立，靠 activeTurns 探针才发现）。
  (/params\?\.turn\?\.id \?\? params\?\.turnId \?\? params\?\.id/.test(main)
    ? ok : fail)("【52】回合 id 三种形态都收（否则闸门拿不到真实计数）");
  (/METHOD === "thread\/status\/changed"/.test(main) && /st === "idle" \|\| st === "notLoaded"/.test(main)
    ? ok : fail)("【52】线程变空闲时释放**该线程**的记账（引擎侧权威信号，防记账泄漏卡死闸门）");
  (/(?:ipcMain|ipcHost)\.handle\("engine:active-turns"/.test(main) && /engineActiveTurns: \(\) => __ipc\("engine:active-turns",/.test(pre)
    ? ok : fail)("【52】有「活跃回合数」探针（验收必须确认前置成立，否则测的是「不忙时当然不推迟」）");

  // ④ 安装目录漂移自愈（09-19 用户：「还有没有绝对路径的，通通查出来解决掉」）
  (/const envPathStale = Boolean\(expectedFirst\)/.test(main)
    ? ok : fail)("【52】config.toml 的 PATH 会与当前安装目录比对（搬家后自愈）");
  (/envPathStale \|\| instructionsOutdated/.test(main) ? ok : fail)("【52】PATH 漂移被纳入自愈触发条件");

  // ④ 台账 + 通知（诊断"是谁打断的" + 告诉用户"改动待生效"）
  (/(?:ipcMain|ipcHost)\.handle\("engine:restart-log"/.test(main) ? ok : fail)("【52】有重启台账 IPC（下次再断能查到是谁触发的）");
  (/engineRestartLog: \(\) => __ipc\("engine:restart-log",/.test(pre) ? ok : fail)("【52】preload 暴露台账");
  (/engineRestartLog\(\): Promise</.test(viteEnv) ? ok : fail)("【52】台账有类型声明（IPC 三件套同步）");
  (/onEngineRestartDeferred:/.test(pre) && /onEngineRestartDeferred\(listener/.test(viteEnv)
    ? ok : fail)("【52】重启被推迟/补做的通知通道三件套齐全");
  (/onEngineRestartDeferred\?\.\(\(event\) => \{/.test(appSrc52) && /改动已保存，将在当前任务结束后生效/.test(appSrc52)
    ? ok : fail)("【52】渲染层明确提示「改动已保存、任务结束后生效」（否则用户以为没保存成功）");

  // ⑤ 钉顶：留白收缩后的**可达性守卫** + 排队消息的钉顶意图（09-19 用户实测「钉顶也没有」）
  const appSrc53 = readAppUi();
  // ⛔ 真机打点复现：留白收缩过头后，落点变成"滚不到的地方"，scrollTop 被 maxScroll 钳死，
  //    pin-fix 每次都滚到同一个被钳住的位置、err 一路变大（21→59→100→253），消息停在半屏。
  //    ⇒ 收缩必须检查「要滚到的位置是否超过 maxScroll」，超了就把缺口还给留白。
  (/if \(want > max \+ 1\) \{/.test(appSrc53) ? ok : fail)("【53】留白收缩后检查落点是否可达（否则被 maxScroll 钳死）");
  (/anchorPadAppliedRef\.current = restore;/.test(appSrc53) && /dbg\("pad-restore"/.test(appSrc53)
    ? ok : fail)("【53】落点不可达时把缺口**还给留白**（不是只打点）");
  // ⛔ 运行中发的消息走 thread/queue/add，随后的「回合结束自动启动 / 立即」两条释放路径
  //    原先都不建立钉顶意图 → 那条消息落进内容流（实测 pad≈0、消息停在半屏）。
  const queueArmCalls = (appSrc53.match(/armPinForReleasedQueue\(/g) || []).length;
  (queueArmCalls >= 4 ? ok : fail)(`【53】排队释放的三条路径都建立钉顶意图（定义+3 处调用，实测 ${queueArmCalls}）`);
  (/"auto-start"/.test(appSrc53) && /"steer"/.test(appSrc53) && /"queue-start"/.test(appSrc53)
    ? ok : fail)("【53】自动启动 / 立即插队 / 立即开新回合 都覆盖");
  // 只对**正在看的**会话建立意图：给后台会话设了会抢走视口
  (/threadId !== threadRef\.current\?\.id\) return;/.test(appSrc53)
    ? ok : fail)("【53】只对当前可见会话建立钉顶意图（后台会话不抢视口）");
  // ⛔ 释放失败必须**撤回**意图（代码审查抓出的缺口）：否则意图悬空，钉顶会去钉列表里
  //    最后那个回合组的消息 ⇒ 视口莫名跳到旧消息，比"没钉顶"更糟。
  const disarmCalls = (appSrc53.match(/disarmPinIntent\(/g) || []).length;
  (disarmCalls >= 4 ? ok : fail)(`【53】释放失败时撤回钉顶意图（定义+3 处调用，实测 ${disarmCalls}）`);
  (/dbg\("queue-arm-cancelled"/.test(appSrc53) ? ok : fail)("【53】撤回有打点（下次能看出是「建立后撤回」还是「压根没建立」）");

  // ⑤b 用户手动停止 ⇒ 排队消息不得被自动发送；**排队本身原地不动**（留在输入框上方那张卡里）。
  //     口径来源：用户 09-23 先要求「不应被自动发送，应保留」，随后**更正**：「不是停留到输入框里面，
  //     是停留在输入框上面；要是排队好几个消息怎么办，要保持排队消息、停留在输入框上面」
  //     ⇒ 第一版做的「把排队消息从引擎队列摘走并拼进输入框」是**错的**（多条会糊成一条草稿），已删除。
  //     ⛔ 唯一拦截点 = `turn/completed` 的「自动启动下一条排队消息」。真机实测：被**中断**的回合结束时
  //     引擎**不会**自己释放队列（排队卡里那条 12.5s 后仍在、且没被当用户消息发出）⇒ 不需要动队列。
  {
    const stopAt = appSrc53.indexOf("async function interrupt()");
    const stopBody = stopAt >= 0 ? appSrc53.slice(stopAt, stopAt + 4000) : "";
    const flagSet = stopBody.indexOf("manualStopRef.current.set(");
    // ⛔ 判据取「第一个**真实** await」而不是字符串 "await "：注释正文里也会出现这个词，
    //    用它当位标会把注释当成代码（第一版就这么假红了一次）。
    const firstAwait = stopBody.indexOf('await window.codex.request("turn/interrupt"');
    (flagSet >= 0 && firstAwait >= 0 && flagSet < firstAwait ? ok : fail)(
      "【115】「手动停止」旗标在**第一个 await（turn/interrupt）之前**同步写入（回合结束事件可能先于 interrupt 回包到达）"
    );
    // ⛔ 负面断言：interrupt() 里**不许**再出现「摘队列 / 写回输入框」——那是被用户否掉的口径。
    (!/thread\/queue\/delete/.test(stopBody) && !/setPrompt\(/.test(stopBody) && !/pullQueuedToComposer/.test(stopBody)
      ? ok : fail)(
      "【115】停止时**不动排队消息**（不摘引擎队列、不写回输入框）——排队卡原地保留，用户自己决定立即/编辑/删除"
    );
    (/"manual-stop-no-autostart"/.test(appSrc53) && /if \(wasManualStop\) \{/.test(appSrc53) ? ok : fail)(
      "【115】turn/completed 的「自动启动排队消息」被手动停止短路（这是**唯一**拦截点）"
    );
    // 拦手动停止，但**不能把自动启动整段删掉**：正常回合结束仍必须照旧释放队列
    (/if \(wasManualStop\) \{[\s\S]{0,260}\} else \{/.test(appSrc53) && /"auto-start"/.test(appSrc53) ? ok : fail)(
      "【115】短路只加在手动停止这一支：正常回合结束照旧自动启动（`else` 分支 + `auto-start` 意图仍在）"
    );
    // ⛔ 09-24 用户反馈（截图）：「排队消息出去，正常的，为啥报这个错」——
    //   实测事实：上一回合结束后约 9ms 引擎就**自己启动**排队消息并清空队列 ⇒ 宿主这次
    //   `thread/queue/start` 落在其后，引擎回 `queued submission not found: <id>`。消息其实正常发出，
    //   报错纯属噪声。这类「已经被启动 / 已不在队列」的失败必须按**成功**处理（不弹 toast、
    //   **保留**钉顶意图），判据集中在 lib/queue-errors.mjs（三处入口共用，别各写一份正则）。
    const queueErrLib = existsSync(join(ROOT, "src", "lib", "queue-errors.mjs"))
      ? readFileSync(join(ROOT, "src", "lib", "queue-errors.mjs"), "utf8") : "";
    (/queued submission not found/.test(queueErrLib) ? ok : fail)(
      "【115】队列「伪失败」判据库在（lib/queue-errors.mjs 认 queued submission not found / queue is empty）"
    );
    const queueErrUses = (appSrc53.match(/isQueueAlreadyStartedError\(/g) || []).length;
    (queueErrUses >= 3 ? ok : fail)(
      `【115】三处 queue/start 的失败分支都过「已被引擎启动」判据（自动启动 / 自动续接 / 立即；实测 ${queueErrUses} 处）`
    );
    (!/showToast\("队列启动失败", error\.message\)/.test(appSrc53) ? ok : fail)(
      "【115】不许再把「已被引擎启动」当失败弹原始错误（原实现直接 showToast(error.message)）"
    );
    // ⛔ 判据**跑真代码**的真值表（不是字符串断言）：宽了会把真失败吞掉，窄了噪声又回来。
    (isQueueAlreadyStartedError("Error: queued submission not found: 01a0d2cd-a4b1-7771-a00f-abbb0e6594f0")
      && isQueueAlreadyStartedError("queue is empty")
      && isQueueAlreadyStartedError("no such queued submission")
      && !isQueueAlreadyStartedError("no active turn to steer")
      && !isQueueAlreadyStartedError("thread not found")
      && !isQueueAlreadyStartedError("")
      && !isQueueAlreadyStartedError(undefined) ? ok : fail)(
      "【115】「已启动」判据真值表：命中 queued submission not found / queue is empty，放行 no active turn / thread not found / 空值"
    );
    (/isTruncatedEmptyTurn\(localTurn \?\? params\.turn\) && !wasManualStop/.test(appSrc53) ? ok : fail)(
      "【115】手动停止的回合不做「截断空转自动续接」（否则停止后 2.5s 会再自动发一条并启动新回合）"
    );
    (/manualStopTurnId && manualStopTurnId === String\(params\.turn\?\.id \?\? ""\)/.test(appSrc53) ? ok : fail)(
      "【115】手动停止按 turnId 精确比对（只对这一次生效，别的回合正常结束照旧自动启动）"
    );
    // 旧方案不许复活：整个应用代码里不应再有「把排队消息摘回输入框」的实现
    (!/pullQueuedToComposer/.test(appSrc53) ? ok : fail)(
      "【115】旧的「摘回输入框」方案已彻底移除（多条排队会糊成一条草稿，用户 09-23 明确否掉）"
    );
  }

  // ⑥ contextWindow 单一真相源（09-19 用户实测：custom-model.json 该模型写 1M、custom-models.json
  //    同一供应商顶层写 128000 —— 两个字段表达同一件事却由两个来源写，每次新建供应商都会留下一对打架的数字）
  const mainWin = readMainSource();
  const withModelsAt = mainWin.indexOf("function withModels(");
  const withModelsBody = withModelsAt >= 0 ? mainWin.slice(withModelsAt, withModelsAt + 1600) : "";
  (/const effectiveWindow = result\.model/.test(withModelsBody) ? ok : fail)(
    "【54】供应商顶层 contextWindow 在唯一写入点归一为「生效模型自己的值」（否则两处数字打架）"
  );
  (/contextWindow: effectiveWindow/.test(withModelsBody) ? ok : fail)("【54】归一结果真的写回顶层（不是只算了个变量）");
  ((mainWin.match(/contextWindow: effectiveWindow/g) || []).length === 1
    ? ok : fail)("【54】归一只有一个 owner（写在 withModels 里，不散在各调用点）");
  // 模型编辑器必须说清「哪个才是生效上限」，否则用户看到一个数字、文件里另一个
  (/才是\*\*生效上限\*\*/.test(appSrc53) ? ok : fail)("【54】模型编辑器标明「本模型的值才是生效上限」（顶层只是默认值）");

  // ⑦ 会话绝对独立（09-19 用户：「不准再因为切换会话、别的独立弹窗关闭影响正在运行的会话，
  //    每个会话都是绝对独立运行状态……除了用户停止，不许再断」）
  //    三条硬约束：① 渲染层**不许**用快照熄灭运行态；② 引擎侧 idle 必须核实后再熄灭；
  //    ③ 主进程 `turn/start` 有"该会话仍有活动回合就拒绝"的兜底（引擎侧事实，不依赖渲染层状态）。
  const appSrc55 = readAppUi();
  const srvSrc55 = readFileSync(join(ROOT, "electron", "codex-server.ts"), "utf8");
  const mainSrc55 = readMainSource();
  (!/else markThreadStopped\(id\);/.test(appSrc55) ? ok : fail)(
    "【55】渲染层不再用「快照里没有 running 回合」熄灭运行态（否则切会话会把在跑的会话判死）"
  );
  (!/else markThreadStopped\(params\.threadId\);/.test(appSrc55) ? ok : fail)(
    "【55】thread/status/changed 的 idle 不再无条件熄灭运行态"
  );
  (/else if \(statusType === "idle"\)[\s\S]{0,400}engineActiveTurns\(\)/.test(appSrc55) ? ok : fail)(
    "【55】idle 改为与引擎侧记账核实后再熄灭"
  );
  (/method0 === "turn\/aborted"/.test(appSrc55) ? ok : fail)(
    "【55】渲染层处理 turn/aborted|failed|interrupted（否则被中断的回合转圈永远挂着）"
  );
  (/if \(method === "turn\/start"\)[\s\S]{0,700}\[\.\.\.engineActiveTurnIds\.values\(\)\]\.includes\(guardThreadId\)/.test(mainSrc55)
    ? ok : fail)("【55】主进程兜底：该会话仍有活动回合时拒绝 turn/start（成对引擎侧事实，防打断）");
  (/setEngineSpawnHook\(/.test(srvSrc55) && /this\.onEngineSpawned\?\.\(\)/.test(srvSrc55) ? ok : fail)(
    "【55】引擎进程重建即回调（主进程据此作废失效回合记账）"
  );
  (/server\.setEngineSpawnHook\(\(\) => \{[\s\S]{0,400}engineActiveTurnIds\.clear\(\)/.test(mainSrc55) ? ok : fail)(
    "【55】主进程在引擎重建时清记账（否则闸门/安全网永久卡住：改配置永不生效、消息发不出去）"
  );

  // ⑧ 会话「项目地址」改动必须真落到侧栏（09-19 用户实测：「在已创建会话上改了地址，只是对话框上面
  //    显示改了，左侧栏没有变化，新增的项目地址也不出现 —— 这个切换项目地址功能这样看就是假的」）
  const appSrc56 = readAppUi();
  (/setThreads\(\(current\) => current\.map\(\(entry\) => entry\.id === target\.id \? \{ \.\.\.entry, cwd: value \}/.test(appSrc56)
    ? ok : fail)("【56】改项目地址会同步列表条目（侧栏项目分组是按 entry.cwd 派的，不同步=侧栏不变）");
  (/thread-cwd-override-v1/.test(appSrc56) && /rememberThreadCwd\(/.test(appSrc56) ? ok : fail)(
    "【56】改过的地址落本地覆盖（引擎 thread/list 回包的 cwd 是创建时那个，不覆盖下一次刷新就顶回去）"
  );
  ((appSrc56.match(/withCwdOverride\(entry\)/g) || []).length >= 2 ? ok : fail)(
    "【56】每条会话列表刷新路径都贴本地覆盖（漏一条就等于改了个寂寞）"
  );
  (/projectAutoExpandRef/.test(appSrc56) ? ok : fail)(
    "【56】启动首次拿到项目分组时自动展开当前会话所在项目（用户实测「要手动展开」）"
  );
  (/setWorkspace\(effectiveCwd\(id, result\.cwd\)\)/.test(appSrc56) ? ok : fail)(
    "【56】打开会话时顶栏显示的是覆盖后的地址（与侧栏保持一致）"
  );
  // ⑨ 语气自适应（09-19 用户要求「agent 有状态、语气跟着变」）：
  //    底线 = **每个会话绝对独立**（09-19 铁律）——状态按会话各自一份，注入走会话自己的 instructions。
  const appSrc57 = readAppUi();
  // ⛔ 判据必须落在**代码**上：注释掉调用仍需报红（否则「// bumpMood(...)」照样匹配正则 = 假绿）。
  //    这里只剔「整行 // 注释」，**不用 codeOnly**——它会把成对的 /* */ 也剥掉，
  //    App.tsx 里只要有一处不配对就会吞掉后面的代码，让下面的守卫变成假红。
  const appSrc57Code = appSrc57.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join("\n");
  (/"agent-mood-" \+ threadId/.test(appSrc57Code) ? ok : fail)(
    "【57】状态键按会话拼（含 threadId）—— 全局单份会让 A 会话的心情改到 B 会话的语气"
  );
  (!/localStorage\.setItem\("agent-mood"/.test(appSrc57Code) ? ok : fail)(
    "【57】不存在不带 threadId 的全局状态写入（全局单份 = 会话互相污染）"
  );
  const sigLine57 = appSrc57Code.split(/\r?\n/).find((l) => /signature:/.test(l) && /sessionScopeSignature\(values\)/.test(l)) || "";
  (/moodSignature\(readMood\(threadId\)\)/.test(sigLine57) ? ok : fail)(
    "【57】下发签名含语气档（漏了 = 状态变了也不重新下发，功能看着像没生效）"
  );
  (/composeMoodInstructions\(composeScopeInstructions\(base, sessionScopeBlock\(values\)\)/.test(appSrc57Code) ? ok : fail)(
    "【57】语气块随会话作用域一起下发（同一通道 = 天然按会话隔离）"
  );
  (/bumpMood\(params\.threadId, "turn-ok"\)/.test(appSrc57Code) ? ok : fail)("【57】回合顺利收尾记「向好」");
  (/bumpMood\(params\.threadId, "turn-fail"\)/.test(appSrc57Code) ? ok : fail)("【57】失败/中断/被中止记「转差」");
  (/bumpMood\(threadRef\.current\.id, userSig\)/.test(appSrc57Code) ? ok : fail)("【57】用户语气信号（被夸/被催）也进状态");
  const forgetCalls57 = (appSrc57Code.match(/forgetThreadMood\(/g) || []).length;
  (forgetCalls57 >= 4 ? ok : fail)(`【57】删除会话时级联清状态与签名（定义+3 处调用，实测 ${forgetCalls57}）`);
  (/adaptiveToneRef\.current = next;/.test(appSrc57Code) ? ok : fail)(
    "【57】开关用 ref 镜像（onHarnessEvent 的闭包读不到新 state，直接读 state 会永远读到初值）"
  );

  // 纯函数断言：直接跑 agent-mood.mjs 的真实现
  {
    const wild = normalizeMood({ valence: 99, energy: -5, rapport: 42, turns: -3 });
    (wild.valence === 1 && wild.energy === 0.05 && wild.rapport === 1 && wild.turns === 0 ? ok : fail)(
      "【57】坏值/越界一律归一（有界，不漂）"
    );
    // 从高水平起连败：valence 触底后下降量会变 0（那是下界在起作用，不是惩罚变小）
    let s57 = { ...emptyMood(), valence: 0.9, energy: 0.9 };
    const pen57 = [];
    for (let i = 0; i < 7; i++) { const before = s57.valence; s57 = applyMoodSignal(s57, "turn-fail", 1000); pen57.push(Number((before - s57.valence).toFixed(4))); }
    (pen57[0] === 0.12 && pen57[1] === 0.15 && pen57[6] === 0.3 ? ok : fail)(
      `【57】连败惩罚递增且封顶 0.30（实测 ${pen57.join("/")}）`
    );
    (applyMoodSignal({ ...emptyMood(), valence: -0.95 }, "turn-fail", 1000).valence >= -1 ? ok : fail)(
      "【57】惩罚不把心情推过下界（有界，不会越挫越负到无意义）"
    );
    let w57 = emptyMood();
    for (let i = 0; i < 50; i++) w57 = applyMoodSignal(w57, "turn-ok", 1000);
    (w57.valence > 0 && w57.valence <= 1 && w57.energy <= 1 && w57.rapport <= 1 ? ok : fail)(
      `【57】连续成功收敛到正侧且不越界（实测 valence=${w57.valence.toFixed(3)}）`
    );
    const bad57 = applyMoodSignal(applyMoodSignal(emptyMood(), "turn-fail", 1000), "turn-fail", 1000);
    const later57 = decayMood(bad57, 1000 + 3 * 60 * 60 * 1000);
    (Math.abs(later57.valence) < Math.abs(bad57.valence) ? ok : fail)(
      `【57】空闲衰减把状态拉回基线（${bad57.valence.toFixed(3)} → ${later57.valence.toFixed(3)}）`
    );
    (moodTone({ valence: 0, energy: 0.1 }).key === "terse" ? ok : fail)("【57】精力见底 → 极简档");
    (moodTone({ valence: -0.5, energy: 0.6 }).key === "sober" ? ok : fail)("【57】心情偏低 → 收紧档");
    (moodTone({ valence: 0.6, energy: 0.8 }).key === "brisk" ? ok : fail)("【57】心情好+精力足 → 轻快档");
    (moodTone({ valence: 0, energy: 0.5 }).key === "steady" ? ok : fail)("【57】默认平稳档");
    const blk57 = moodBlock(applyMoodSignal(emptyMood(), "turn-ok", 1000), 1000);
    (blk57.includes(MOOD_HEADING) && /\*\*只影响说法/.test(blk57) && /不要在回复里谈论这个状态/.test(blk57) ? ok : fail)(
      "【57】注入块写明「只影响说法」并禁止谈论状态（否则会出现「我现在心情不错」这类噪音）"
    );
    const a1 = moodSignature({ valence: 0.1, energy: 0.5, rapport: 0.1, updatedAt: 1 });
    const a2 = moodSignature({ valence: 0.2, energy: 0.6, rapport: 0.2, updatedAt: 2 });
    (a1 === a2 && a1 !== "" ? ok : fail)(`【57】签名不含浮点（同档同签名，实测 ${a1} vs ${a2}）`);
    // 模拟「上一次下发过的完整文本又被当基线传进来」：块只能出现一次（翻倍 = 每轮重发越拼越长）
    const twice57 = composeMoodInstructions(composeMoodInstructions("BASE", blk57), blk57);
    ((twice57.match(/会话状态（语气自适应/g) || []).length === 1 ? ok : fail)("【57】组合/剥离幂等（反复重发不会越拼越长）");
    let mA = emptyMood();
    let mB = emptyMood();
    for (let i = 0; i < 3; i++) mA = applyMoodSignal(mA, "turn-fail", 1000);   // A 连败三次
    mB = applyMoodSignal(mB, "turn-ok", 1000);
    (moodTone(mA).key === "sober" && moodTone(mB).key !== "sober" ? ok : fail)(
      `【57】两会话各自演进语气不同（A=${moodTone(mA).key} / B=${moodTone(mB).key}）`
    );
    (moodSignature(mB) === moodSignature(applyMoodSignal(emptyMood(), "turn-ok", 1000)) ? ok : fail)(
      "【57】A 的连败没有改到 B 的状态（同一份输入跑出同一份结果，证明确实各存各的）"
    );
  }


  // ⑩ 浏览器专用技能 browser-skill（09-19 用户：「browser skill 内置到已安装技能里面，专门跑浏览器自动化」
  //    → 随后「这个更好，那个替换掉」：改用 browser-skill 替换 browser-automation）
  //    要点：① 随应用写入 codexHome/skills/（内置=代码为准，启动时按内容覆盖）
  //          ② 内容必须覆盖**真实存在**的命令（照 help 写）且替换后**不丢能力说明**
  //             （ego 优先 / 每会话 TaskSpace / playwright-cli 回落 —— 10-22 替换 CloakBrowser）
  //          ③ 旧技能必须退役清理 —— 内建写入只增不删，不清的话老用户磁盘上那份会继续被加载
  //          ④ 仍受「浏览器自动化」总闸管（名单 = BROWSER_SKILL_IDS）
  const bsSrc58 = readBuiltinSkillsSource();
  (/\["browser-skill", BROWSER_SKILL\]/.test(bsSrc58) ? ok : fail)(
    "【58】browser-skill 已注册进内置技能（随应用启动写入 codexHome/skills/）"
  );
  (!/\["browser-automation", BROWSER_SKILL\]/.test(bsSrc58) ? ok : fail)(
    "【58】旧技能不再被写入（browser-automation 已退役，否则两套浏览器说明同时加载）"
  );
  (/name: browser-skill[\r\n]/.test(bsSrc58) ? ok : fail)(
    "【58】技能 frontmatter 的 name 与目录名一致（browser-skill，否则引擎按名字索引不到）"
  );
  // 技能必须覆盖 ego 的真实 API（写错模型就照着错命令试）
  const bsCmds58 = ["taskSpace", "snapshot", "waitForSelector", "evaluate", "screenshot", "nuphus-call"];
  const bsMiss58 = bsCmds58.filter((k) => !bsSrc58.includes(k));
  (bsMiss58.length === 0 ? ok : fail)(`【58】技能覆盖真实实操命令（缺：${bsMiss58.join("、") || "无"}）`);
  // 替换后不能丢能力说明：通道优先级 + 每会话 TaskSpace + 回落通道（10-22 ego 替换 Cloak）
  const bsMerge58 = ["ego-browser", "TaskSpace", "CODEX_THREAD_ID", "nuphus-call"];
  const bsLost58 = bsMerge58.filter((k) => !bsSrc58.includes(k));
  (bsLost58.length === 0 ? ok : fail)(
    `【58】替换后能力说明未丢失（缺：${bsLost58.join("、") || "无"}）`
  );
  // 退役清理：指纹比对 + 兼容 .disabled（被总闸禁用过的旧技能也要能清）
  (/const RETIRED_SKILLS: \[string, string\]\[\] = \[\["browser-automation", RETIRED_BROWSER_SKILL\]\]/.test(bsSrc58) ? ok : fail)(
    "【58】旧技能进了退役名单（否则老用户磁盘上那份永远留着）"
  );
  /* ⛔ 判据锚「循环里把两种停用名都列了」这个**取值形态**，不锚某个固定数组写法 ——
   * 10-06 改成常量数组（SKILL_FILE / SKILL_FILE_DISABLED / SKILL_FILE_POOL_DISABLED）后，
   * 原先的字面量匹配立刻假红（内容没退化，只是写法换了）。 */
  (/for \(const fn of \[[^\]]*SKILL_FILE_DISABLED[^\]]*SKILL_FILE_POOL_DISABLED[^\]]*\]/.test(bsSrc58) ? ok : fail)(
    "【58】退役清理把两种停用形态都算进去（总闸 .disabled + 技能池 .pool-disabled）"
  );
  // ⛔ 判据锚「两边都归一化行尾」这个不变量本身，不锚具体语句形态（语句会被重构，不变量不会）
  (/existing\.replace\(\/\\r\\n\/g, "\\n"\)/.test(bsSrc58) && /original\.replace\(\/\\r\\n\/g, "\\n"\)/.test(bsSrc58) ? ok : fail)(
    "【58】退役清理归一化行尾后比对指纹（否则被停用/启用重写成 LF 的旧技能永远清不掉）"
  );
  const cgSrc58 = readFileSync(join(ROOT, "src", "lib", "capability-groups.ts"), "utf8");
  (/BROWSER_SKILL_ID = "browser-skill"/.test(cgSrc58) ? ok : fail)(
    "【58】总闸管的是新技能名（还指着旧名 = 关总闸关不到真正的技能）"
  );
  (/BROWSER_SKILL_IDS: readonly string\[\] = \[BROWSER_SKILL_ID\]/.test(cgSrc58) ? ok : fail)(
    "【58】技能名单与主技能名一致（名单里留着已退役的名字 = 状态永远对不上）"
  );
  const appSrc58b = readAppUi();
  (/findCapabilitySkills\(localSkills as any\[\], BROWSER_SKILL_IDS\)/.test(appSrc58b) ? ok : fail)(
    "【58】渲染层按名单聚合技能状态（总闸显示才不会与实际状态脱节）"
  );
  (/browserSkills: findCapabilitySkills\(skills, BROWSER_SKILL_IDS\)/.test(appSrc58b) ? ok : fail)(
    "【58】联动后复算也走同一份名单"
  );
  // ⛔ 开机自愈只**拉齐子项**，方向必须取自各总闸**自己的落盘状态**（写代码模式 =
  //    config.json 的 defaultMode；桌面/浏览器 = app-settings 总闸布尔）——
  //    ⛔ 不许写死常量、也不许由 groupState 的 partial 反推方向：
  //    · 写死 true = 每次开机把总闸拉回开启（09-27 用户反馈，真缺陷）；
  //    · groupState partial 反推 = 10-01 用户反馈真缺陷：插件未装时 ponytailPluginOn
  //      误判 true → 整组 partial → 目标定为开 → 用户关掉的写代码模式重启被拉回 full。
  //      锚「targets 表逐项取自 snapshot 总闸字段 + target 从表取值」这个不变量。
  ((() => {
    const heal = /const plan = planAction\(snapshot, groupId, ([^)]+?)\);/.exec(appSrc58b);
    if (!heal) return false;
    const arg = heal[1].trim();
    if (/^(true|false)$/.test(arg)) return false;               // 常量目标 = 每次开机覆盖用户的选择
    return new RegExp("const\\s+" + arg + "\\s*=\\s*healTargets\\[groupId\\]").test(appSrc58b)
      && /"writing-code": snapshot\.ponytailOn/.test(appSrc58b)
      && /"desktop-automation": snapshot\.desktopAuto/.test(appSrc58b)
      && /"browser-automation": snapshot\.browserAuto/.test(appSrc58b);
  })() ? ok : fail)(
    "【58】开机自愈的方向取自总闸落盘状态（写死 true 或 partial 反推 = 用户关掉的开关重启又被打开）"
  );
  // ⛔ 插件未安装 ≠ 启用：ponytailPluginOn 必须先判 entry 存在（未装判 true 会把整组
  //    顶成 partial，见上条）。
  (/ponytailPluginOn:\s*ponytailPluginEntry\s*\?\s*ponytailPluginEntry\.enabled !== false\s*:\s*false/.test(appSrc58b) ? ok : fail)(
    "【58】未安装的 ponytail 插件不算「启用」（entry?.enabled !== false 会在未装时算出 true，把整组顶成 partial 触发自愈误开）"
  );
  // ⛔ 写代码模式缺省一律 off（10-01 用户令：默认关、关了就是关了）——主进程读档与
  //    渲染层自愈兜底两处都不许回退 full。
  const pmSrc58 = readFileSync(join(ROOT, "electron", "conventions", "ponytail-mode.ts"), "utf8");
  (/String\(raw\.defaultMode \?\? "off"\)/.test(pmSrc58) && /catch \{[\s\S]{0,60}?return "off";/.test(pmSrc58) ? ok : fail)(
    "【58】写代码模式落盘缺省 = off（config.json 缺失/读不了时回退 full = 关掉的开关重启被拉开）"
  );
  (appSrc58b.includes('?? Promise.resolve("off")).catch(() => "off")') ? ok : fail)(
    "【58】渲染层自愈读总闸的兜底也是 off（兜底 full 会让读档失败的用户被默认开启）"
  );
}
}

{
{
  // ── 【59】回合「输出被上游截断」的检测 + 自动续接（09-19 用户实测「思考内容过长会被截断，
  //    运行状态就断了」；真机取证：商汤把单次响应钳到 8192，思考 16365 字符吃满预算 → 正文 0
  //    字符 → 引擎当 task_complete 正常收尾。本地部署模型同样有单次输出上限）。──
  //    核心不变量：① 检测是纯函数、可被断言 ② 应用对思考/输出**不做任何限制** ③ 检测到截断
  //    要自动续接（承接语义，从断点续写）④ 防死循环有窗口/次数上限 ⑤ 不把正常回合误判成截断。
  const ttSrc59 = readFileSync(join(ROOT, "src", "lib", "turn-truncation.mjs"), "utf8");
  const appSrc59 = readAppUi();

  // —— 行为断言（跑真实实现，覆盖「正常回合不误报」这个最关键的不变量）——
  const t59 = { items: [
    { type: "userMessage", id: "u1" },
    { type: "reasoning", id: "r1", summary: [{ text: "x".repeat(2000) }], content: [{ text: "y".repeat(15000) }] }, // 思考极长（≈16.4K 字符）
    { type: "agentMessage", id: "a1", text: "" }, // 正文空
    // 无任何工具 item
  ]};
  const t59ok = { items: [
    { type: "reasoning", id: "r1", summary: [{ text: "z".repeat(9000) }] }, // 思考长
    { type: "agentMessage", id: "a1", text: "完整的一段回答，不止一句话。".repeat(200) }, // 有正文
  ]};
  const t59tool = { items: [
    { type: "reasoning", id: "r1", summary: [{ text: "z".repeat(9000) }] }, // 思考长
    { type: "agentMessage", id: "a1", text: "" },
    { type: "functionCallOutput", id: "f1", name: "exec_command", output: "ok" }, // 有工具动作
  ]};
  const t59short = { items: [
    { type: "reasoning", id: "r1", summary: [{ text: "短思考" }] },
    { type: "agentMessage", id: "a1", text: "" },
  ]};
  // ⛔ 用户提醒「不要让正常收尾产生空转」的关键区间：思考很长 + **短结论**（20~300 字符之间，
  //   比如"好的，按方案 A 做"）+ 无工具 —— 这是正常收尾，绝不能误判成截断（否则自动续接
  //   会多出一个应用自己发的回合 = 空转）。20 阈值下短结论(>20)不判；放宽到 300 必误判 → 反证红。
  const t59shortReply = { items: [
    { type: "reasoning", id: "r1", summary: [{ text: "z".repeat(9000) }] }, // 思考长
    { type: "agentMessage", id: "a1", text: "好的，按方案 A 来，我这就去处理，完成后立刻把结果发给你看。" }, // 正常短结论（>20 且 <300，20 阈值下不误判）
  ]};
  // ⛔ 真实形态（rollout 实证）：引擎在截断时把思考摘要**逐字复制**成 agentMessage 当正文
  //   （task_complete 的 last_agent_message 就是它）——「正文非空」不等于「有产出」。
  const t59echo = { items: [
    { type: "reasoning", id: "r1", summary: [{ text: "s".repeat(9000) }], content: [] }, // 思考长
    { type: "agentMessage", id: "a1", text: "s".repeat(9000) }, // 正文 = 思考复述（逐字相同）
  ]};
  const t59real = { items: [
    { type: "reasoning", id: "r1", summary: [{ text: "s".repeat(9000) }], content: [] }, // 思考长
    { type: "agentMessage", id: "a1", text: "这是真正的产出正文，不是思考的复述。".repeat(100) }, // 真实正文 ≠ 思考
  ]};
  (isTruncatedEmptyTurn(t59) ? ok : fail)("【59】截断空转（长思考+空正文+无工具）判真");
  (isTruncatedEmptyTurn(t59echo) ? ok : fail)("【59】正文=思考逐字复述 判真（引擎截断时把思考摘要复制成正文，复述≠产出）");
  (isTruncatedEmptyTurn(t59real) ? fail : ok)("【59】正文是真实产出（≠思考）不误判");
  (isTruncatedEmptyTurn(t59ok) ? fail : ok)("【59】有正文的正常回合不误判");
  (isTruncatedEmptyTurn(t59tool) ? fail : ok)("【59】有工具动作的回合不误判");
  (isTruncatedEmptyTurn(t59short) ? fail : ok)("【59】思考不长的空回合不误判");
  (isTruncatedEmptyTurn(t59shortReply) ? fail : ok)("【59】长思考+正常短结论的回合不误判（防正常收尾被当成截断 → 空转）");
  const s59 = turnOutputStats(t59);
  (s59.reasoningChars >= TRUNCATE_REASONING_MIN_CHARS && s59.outputChars < TRUNCATE_OUTPUT_MAX_CHARS && s59.toolItems === 0 ? ok : fail)(
    `【59】统计口径正确（思考=${s59.reasoningChars} / 正文=${s59.outputChars} / 工具=${s59.toolItems}）`
  );

  // —— 结构不变量 ——
  (AUTO_CONTINUE_MAX_ATTEMPTS >= 1 && AUTO_CONTINUE_MAX_ATTEMPTS <= 3 ? ok : fail)(
    `【59】自动续接次数上限合理（${AUTO_CONTINUE_MAX_ATTEMPTS}，防死循环）`
  );
  (/AUTO_CONTINUE_WINDOW_MS/.test(appSrc59) && /autoContinueLogRef/.test(appSrc59) ? ok : fail)(
    "【59】自动续接有防循环记账（窗口+次数，否则思考→截断→又思考烧钱）"
  );
  (/maybeAutoContinueTruncated\(/.test(appSrc59) ? ok : fail)(
    "【59】回合收尾时对截断空转触发自动续接"
  );
  (/thread\/queue\/add/.test(appSrc59) && /thread\/queue\/start/.test(appSrc59) ? ok : fail)(
    "【59】自动续接走队列入队+启动（新回合带全新输出预算）"
  );
  (/从上次中断处继续/.test(ttSrc59) && /不要重新思考/.test(ttSrc59) ? ok : fail)(
    "【59】续接指令是「承接续写」语义（从断点往下写，不是重做任务）"
  );
  (/应用没有对思考或输出做任何限制|应用未做任何限制/.test(ttSrc59) ? ok : fail)(
    "【59】说明里讲清应用未做限制（用户明确要求长思考不受限）"
  );
  (/\bslice\(0,\s*\d{1,4}\s*\)/.test(ttSrc59) ? fail : ok)(
    "【59】检测模块对思考/输出正文不做长度截断（应用不限制输出）"
  );
}
}

{
{
  // ── 【60】侧栏「任务完成」绿点 + 通知真实会话名（09-19 用户：「通知栏总显示未命名会话」
  //    +「会话完成，左侧栏没有反馈效果……点击进去绿点消失」）──
  const appSrc60 = readAppUi();
  const css60 = readStyles();
  // 通知名：fallback 必须传空串（内部 fallback「未命名会话」恒非空 ⇒ 后面的 firstUserTextInTurn
  // 永远执行不到 = 通知永远「未命名会话」的真根因）
  (/cleanThreadDisplayTitle\(entry\?\.name,\s*\{\s*preview:\s*entry\?\.preview,\s*fallback:\s*""\s*\}\)/.test(appSrc60) ? ok : fail)(
    "【60】通知名的会话标题 fallback 传空串（否则内部「未命名会话」恒非空，真实名字永远轮不到）"
  );
  // 绿点状态机
  // ⛔ 点亮必须在**跨会话生命周期区**（method0 分支）：下面的当前会话事件流有 threadId 过滤
  //   （`params.threadId !== threadRef.current?.id → return`），后台会话事件走不到 —— 第一版
  //   把点亮挂在那边，真机验收当场红（绿点永不出现）。
  (/if \(!params\.threadId \|\| params\.threadId !== threadRef\.current\?\.id\) markThreadDoneUnread\(params\.threadId\);\s*\n\s*\} else if \(method0 === "thread\/status\/changed"\)/.test(appSrc60) ? ok : fail)(
    "【60】turn/completed（跨会话区）对后台会话点亮完成绿点（挂在当前会话事件流 = 永不出现）"
  );
  (/markThreadStopped\(params\.threadId\);\s*\n\s*\/\/ 侧栏绿点（失败[^]*?if \(!params\.threadId \|\| params\.threadId !== threadRef\.current\?\.id\) markThreadDoneUnread\(params\.threadId\);/.test(appSrc60) ? ok : fail)(
    "【60】turn/aborted|failed|interrupted 也点亮绿点（失败也算运行结束）"
  );
  (/if\s*\(!threadId\s*\|\|\s*threadId === threadRef\.current\?\.id\)\s*return;/.test(appSrc60) ? ok : fail)(
    "【60】当前正在查看的会话不点绿点（用户全程看着，不需要反馈）"
  );
  (/clearThreadDoneUnread\(entry\.id\)/.test(appSrc60) ? ok : fail)(
    "【60】点击侧栏会话行即清除绿点（用户明令：点进去消失）"
  );
  (/unreadDoneIds\.has\(entry\.id\)\s*\?\s*<span className="thread-done-dot"/.test(appSrc60) ? ok : fail)(
    "【60】侧栏行渲染绿点（running 优先，完成后未读才亮）"
  );
  (/\.thread-done-dot\s*\{/.test(css60) && /#22c55e/.test(css60) ? ok : fail)(
    "【60】绿点样式存在（绿色 = 成功收尾）"
  );
}
}

{
{
  // ── 【62】两条真机复现过的回归守卫（09-19 用户截图/复现）──
  //  ① 「发出去立马切走 → 绿点 → 30 秒内切回 → agent 回复没了」
  //     根因：后台会话的回复内容不落缓存（落缓存都在 threadId 过滤之后）+ openThread 有
  //     「30 秒内跳过 resume」快速路径 ⇒ 缓存没回复且不 resume = 永久缺失。
  //     修法：把「完成的回合落缓存」提到跨会话区（过滤之前）。
  //  ② 「消息回完了，右下角停止键还亮着」
  //     根因之一：迟到的 turn/started 会把已结束的回合重新点亮，而结束事件已消费 ⇒ 无人熄灭。
  //     修法：已结束回合 id 登记 + turn/started 不再点亮它们。
  //  ⛔ 本块刻意**不用 codeOnly**：实测 codeOnly 在本文件上会吃掉 ~177KB 代码
  //    （`/\*[\s\S]*?\*\//g` 被字符串/正则里的 `/*` 误配对，把中间大段代码当块注释剥掉），
  //    导致这里的断言被静默剥空 → 假红（第一版就是这样红的）。锚点本身已足够具体。
  const app62 = readAppUi();
  // ① 跨会话落缓存（turn/completed 与 aborted/failed 两处）
  // ⛔ 合并必须**以「缓存里已有该回合」为前提**：否则 mergeTurn 会把只有产出条目的回合
  //   追加成「没有用户消息的孤儿回复」（用户实测：一个用户消息下挂两条回复 / 回复重复）。
  //   缓存缺这一轮时改登记 needsFullReloadRef，让 openThread 必须 resume 拿完整回合。
  (/const hasTurn = Boolean\(cachedBg\?\.turns\?\.some\(\(turn\) => turn\.id === params\.turn\.id\)\);[\s\S]{0,260}?if \(cachedBg && hasTurn\) \{[\s\S]{0,260}?mergeTurn\(cachedBg, params\.turn\)[\s\S]{0,420}?needsFullReloadRef\.current\.add\(tidBg\);/.test(app62) ? ok : fail)(
    "【62】只在缓存已有该回合时合并；缺轮则登记完整重载（杜绝孤儿回复）"
  );
  (/const hasTurnFail = Boolean\(cachedFail\?\.turns\?\.some\(\(turn\) => turn\.id === params\.turn\.id\)\);[\s\S]{0,260}?mergeTurn\(cachedFail, params\.turn\)[\s\S]{0,420}?needsFullReloadRef\.current\.add\(tidFail\);/.test(app62) ? ok : fail)(
    "【62】失败/被中断分支同样只在缓存已有该回合时合并"
  );
  (/needsFullReloadRef = useRef<Set<string>>\(new Set\(\)\)/.test(app62) ? ok : fail)(
    "【62】「必须完整重载」登记表存在"
  );
  (/&& !needsFullReloadRef\.current\.has\(id\) && Date\.now\(\) - \(recentResumeAtRef\.current\.get\(id\) \?\? 0\) < 30_000\)/.test(app62) ? ok : fail)(
    "【62】「跳过 resume」快速路径让开必须重载的会话"
  );
  (/needsFullReloadRef\.current\.delete\(id\);/.test(app62) ? ok : fail)(
    "【62】resume 完成后清除「必须重载」标记"
  );
  // 落缓存只写 cache：合并语句里不得出现 setThread（视图仍归当前会话那两条链路）
  (/if \(mergedBg && mergedBg !== cachedBg\) threadCacheRef\.current\.set\(tidBg, mergedBg\);/.test(app62) ? ok : fail)(
    "【62】跨会话合并只写缓存、不直改视图"
  );
  // ② 已结束回合不得再被 turn/started 点亮
  (/const finishedTurnIdsRef = useRef<Set<string>>\(new Set\(\)\)/.test(app62) ? ok : fail)(
    "【62】已结束回合登记表存在"
  );
  (/rememberFinishedTurn\(startedTurnId\);/.test(app62) && /rememberFinishedTurn\(String\(params\.turn\?\.id \?\? params\.turnId \?\? ""\)\);/.test(app62) ? ok : fail)(
    "【62】completed 与 aborted/failed 都登记已结束回合"
  );
  (/if \(!startedAlreadyDone\) markThreadRunning\(params\.threadId, startedTurnId \|\| undefined\);/.test(app62) ? ok : fail)(
    "【62】跨会话 turn/started 不点亮已结束的回合"
  );
  // ⛔ 09-22：分支体提成 `handleXxx` 后，原来的 `return;`（退出 onEvent 回调）改成
  //    `return true;` + 调用处 `if (handleXxx(...)) return;` ⇒ 正则要同时接受两种写法，
  //    判据语义不变（仍是「已结束回合要提前退出，不点亮」）。
  (/if \(postStartTurnId && finishedTurnIdsRef\.current\.has\(postStartTurnId\)\) \{[\s\S]{0,60}?return(?: true)?;/.test(app62) ? ok : fail)(
    "【62】当前会话 turn/started 不点亮已结束的回合（否则停止键永久亮着）"
  );
}
}

{
{
  // ── 【63】429 自动重试必须**按会话独立**（09-19 用户实测：「多会话同时跑，只有当前看的
  //   那个会话会自动重试，后台会话直接断——会话完全没有完全独立」）──
  //   旧实现三处单槽（retryContextRef / rateLimitAttemptRef / rateLimitTimerRef）+ 429 检测点
  //   写在当前会话事件流里（threadId 过滤之后）⇒ 后台会话连排重试都走不到。
  const app63 = readAppUi();
  // ① 三份状态都必须是 per-thread Map
  (/const retryContextsRef = useRef<Map<string, RateLimitCtx>>\(new Map\(\)\)/.test(app63) ? ok : fail)(
    "【63】重试上下文按会话独立（Map，不再是单槽）"
  );
  (/const rateLimitAttemptsRef = useRef<Map<string, number>>\(new Map\(\)\)/.test(app63) ? ok : fail)(
    "【63】重试次数按会话独立（Map）"
  );
  (/const rateLimitTimersRef = useRef<Map<string, number>>\(new Map\(\)\)/.test(app63) ? ok : fail)(
    "【63】重试定时器按会话独立（Map，多会话可同时等待）"
  );
  // ② 旧单槽 API 不得复活
  const legacy = [/retryContextRef\.current(?!s)/, /rateLimitAttemptRef\.current/, /rateLimitTimerRef\.current/].filter((re) => re.test(app63)).length;
  (legacy === 0 ? ok : fail)(
    `【63】旧单槽 API 已清干净（残留 ${legacy} 处；复活=多会话互相覆盖）`
  );
  // ⛔ 09-22：分支体提成 `handleXxx` 后，「跨会话区」的判定不能只看区间内的字面代码 ——
  //    区间里现在只有 `if (handleEventRouter3(bag, event, params)) return;` 这样的**调用**。
  //    改为：区间文本 **+ 该区间调用的每个 handler 模块正文** 一起判定（语义不变：
  //    「429 重试 / engine error 通知 必须能从跨会话区到达」，而不是被 threadId 过滤挡在后面）。
  const FILTER63 = "if (params.threadId && params.threadId !== threadRef.current?.id) return;";
  const walkAllParts = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    if (e.isDirectory()) return walkAllParts(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
  const partsFiles63 = walkAllParts(join(ROOT, "src", "features", "app-state", "parts"));
  const cross63 = (() => {
    for (const p of partsFiles63) {
      const raw = readFileSync(p, "utf8").replace(/\bbag\./g, "");
      const b = raw.indexOf(FILTER63);
      if (b < 0) continue;
      const a = raw.indexOf("── 跨会话生命周期事件");
      return raw.slice(a >= 0 ? a : 0, b);
    }
    return "";
  })();
  const handlerBodies63 = (() => {
    const out = new Map();
    for (const p of partsFiles63) {
      const raw = readFileSync(p, "utf8").replace(/\bbag\./g, "");
      const hits = [...raw.matchAll(/export function (handle[A-Za-z0-9_]+)\s*\(/g)];
      for (let i = 0; i < hits.length; i++) {
        out.set(hits[i][1], raw.slice(hits[i].index, i + 1 < hits.length ? hits[i + 1].index : raw.length));
      }
    }
    return out;
  })();
  let crossWithHandlers63 = cross63;
  for (const m of cross63.matchAll(/\b(handle[A-Za-z0-9_]+)\s*\(/g)) {
    const b = handlerBodies63.get(m[1]);
    if (b) crossWithHandlers63 += "\n" + b;
  }
  (/scheduleRateLimitRetry\(params\.threadId, \(rateLimitAttemptsRef\.current\.get\(params\.threadId\) \?\? 0\) \+ 1\);/.test(crossWithHandlers63) ? ok : fail)(
    "【63】429 排重试在跨会话区（后台会话也能重试；写回过滤之后 = 后台永远不重试）"
  );
  (crossWithHandlers63.includes('method0 === "error"') ? ok : fail)(
    "【63】engine error 通知（429 常见形态）同样在跨会话区处理"
  );
  // ④ 重试发起串行化：**按会话分门**（同一会话不并发投递），跨会话不排队。
  //    ⛔⛔ 09-19 用户严令「每个会话必须完全独立，A 在跑/报错/重试跟 B 一点关系都没有」：
  //    这里**必须**是 per-thread 的 Map，**不许**退回全局单门 —— 全局门会让 B 的重试
  //    排队等 A 发完，正是"会话之间还串着"的根源。
  (/const retryGatesRef = useRef<Map<string, Promise<unknown>>>\(new Map\(\)\)/.test(app63) ? ok : fail)(
    "【63】重试发起串行化按会话分门（跨会话不排队、互不等待）"
  );
  (/retryGatesRef\.current\.set\(threadId, guarded\)/.test(app63) ? ok : fail)(
    "【63】串行门按 threadId 写入（同一个会话才排队）"
  );
  (/if \(retryGatesRef\.current\.get\(threadId\) === guarded\) retryGatesRef\.current\.delete\(threadId\)/.test(app63) ? ok : fail)(
    "【63】串行门用后即清（不在 Map 里无限累积）"
  );
  (!/\bretryGateRef\b(?!s)/.test(app63) ? ok : fail)(
    "【63】已无全局单门 retryGateRef（会话完全独立的结构保证）"
  );
  (/const delay = Math\.round\(base \* \(0\.8 \+ Math\.random\(\) \* 0\.4\)\);/.test(app63) ? ok : fail)(
    "【63】退避叠 ±20% 抖动（避免多会话同一秒重发）"
  );
  // ⑤ 手动发消息只清**当前会话**的重试（清全部=后台会话直接断）
  (/const focusedForSend = threadRef\.current\?\.id;\s*\n\s*if \(focusedForSend\) cancelRateLimitRetry\(focusedForSend, true\);/.test(app63) ? ok : fail)(
    "【63】手动发送只取消当前会话的重试（不清别的会话）"
  );
  // 权限取法：**按目标会话取 + 白名单**（架构审查发现裸传 localStorage 脏值会被引擎拒收）
  (/sandboxPolicy: sandboxPolicy\(threadSandboxOf\(threadId\) \?\? sandbox, threadCacheRef\.current\.get\(threadId\)\?\.cwd/.test(app63) ? ok : fail)(
    "【63】重试的沙箱目录 + 权限模式都按目标会话取（配置层面不串会话）"
  );
  (/approvalPolicy: threadApprovalOf\(threadId\) \?\? approvalPolicy/.test(app63) ? ok : fail)(
    "【63】重试的审批策略同样按目标会话取"
  );
  (/sandboxPolicy: sandboxPolicy\(threadSandboxOf\(ctx\.threadId\) \?\? sandbox, threadCacheRef\.current\.get\(ctx\.threadId\)\?\.cwd/.test(app63) ? ok : fail)(
    "【63】降档重发的沙箱/权限也按目标会话取"
  );
  // 白名单本体：非法/脏值必须被挡（`?? 当前 UI 值` 的兜底不能省）
  (/const SANDBOX_MODES = \["danger-full-access", "read-only", "workspace-write"\] as const;/.test(app63) ? ok : fail)(
    "【63】会话权限读取有白名单（脏值不传给引擎）"
  );
  (/const APPROVAL_MODES = \["never", "on-request", "untrusted"\] as const;/.test(app63) ? ok : fail)(
    "【63】审批档位白名单存在"
  );
}
}

{
{
  // ── 【64】首次安装不得默认启用任何供应商（09-19 用户：「没配置供应商的时候默认不要启用任何
  //   供应商，要不然会跟新配置的供应商同时启用」）──
  //   两处根因：① 保存新供应商时 enabled 无条件默认 true（没填密钥也启用）；
  //            ② 推荐卡（PPtoken 赞助位）默认启用（没记录 = 开）。
  const mainSrc64 = readMainSource();
  const appSrc64 = readAppUi();
  // ① 无密钥的第三方供应商不得报成启用（openai-official 例外：它靠登录凭据）
  //   ⛔ 09-19 补第二个例外：本机/内网自建服务（Ollama/LM Studio/vLLM/llama.cpp）本来就
  //      不需要 Key —— 若也一律禁用，用户配好本地模型却发不出消息且看不出原因。
  //      判据改锚「公网无 Key 仍禁用」这个**不变的意图**，而不是原来的整行字面。
  (/const keylessThirdParty = !hasKey && value\.provider !== "openai-official" && !isLocalEndpoint\(value\.baseUrl\);[\s\S]{0,120}?enabled: keylessThirdParty \? false : value\.enabled !== false/.test(mainSrc64) ? ok : fail)(
    "【64】未配置密钥的供应商不得视为启用（官方订阅 + 本机/内网服务两处例外）"
  );
  /* ⛔ 判据改成「两个代码形态**各自锚定**」，不再用固定字符窗口把两句串起来。
     历史：窗口 220 → 600（09-19 插了并发归一那几行）→ 09-25 又插了几行注释 + 常量替换，
     实测距离 877 ⇒ 红。**这是判据写法的问题，不是代码的问题** —— 固定窗口的跨语句断言
     会随"中间合法地多写一行"而假红，而每次假红都诱人把 N 调大，调到最后等于没约束。
     两句用**同名唯一变量** `keylessThirdPartySave` 绑定，强度不变（该名在文件里唯一）、
     且与中间写了多少行无关。 */
  (/const keylessThirdPartySave = !encryptedKey && provider !== "openai-official" && !isLocalEndpoint\(baseUrl\);/.test(mainSrc64) &&
   /enabled: keylessThirdPartySave \? false : \(input\.enabled \?\? existing\?\.enabled \?\? true\)/.test(mainSrc64) ? ok : fail)(
    "【64】保存新供应商：没填密钥就存成禁用（本机/内网服务例外，与显示侧同源）"
  );
  // ② 推荐卡默认关（只有显式点开过才启用）
  (/localStorage\.getItem\("pptoken-card-off"\) !== "0"/.test(appSrc64) ? ok : fail)(
    "【64】推荐卡默认不启用（首次安装没有任何供应商处于启用态）"
  );
}
}

{
{
  // ── 【65】429 兜底重试必须**任何路径都能接住**（09-19 用户截图「429 重试机制都没有了？
  //   直接中止了？」）── 真机（mock 供应商 429）实测出三个致命点：
  //   ① 引擎把限流包成 `Reconnecting... 10/10`（**文案里没有 429**）⇒ 旧词表落空；
  //   ② 当前会话的 error 分支用**翻译后的中文文案**判定是否限流 ⇒ 翻译后不含 429 ⇒
  //      跨会话区刚排好的重试链被当场 cancel（"有登记也不重试"的元凶）；
  //   ③ 登记只覆盖手动发送 ⇒ 排队释放/重启后恢复的回合没有上下文 ⇒ 检测点 `has()` 落空。
  const appSrc65 = readAppUi();
  const rlSrc65 = readFileSync(join(ROOT, "src", "lib", "rate-limit-retry.ts"), "utf8");
  // ① 引擎重连耗尽 = 可重试信号
  (/Reconnecting/.test(rlSrc65) && /Number\(exhausted\[1\]\) >= Number\(exhausted\[2\]\)/.test(rlSrc65) ? ok : fail)(
    "【65】限流判定覆盖引擎的 `Reconnecting... N/M`（耗尽才算引擎放弃）"
  );
  // ② 清上下文/判限流必须用**原始错误**（rawError + details），不许用翻译后的文案
  (/const rawIsRateLimit = isRateLimitError\(\[rawError, details\]\.join\(" "\)\)/.test(appSrc65) ? ok : fail)(
    "【65】error 分支用原始错误判定是否限流（翻译后文案会丢掉 429 ⇒ 当场清掉重试链）"
  );
  (/&& !rawIsRateLimit\)/.test(appSrc65) ? ok : fail)(
    "【65】非限流才清重试上下文（限流留给重试链）"
  );
  // ③ 三个检测点都走统一入口（含兜底恢复）
  const ensureCalls65 = (appSrc65.match(/ensureRateLimitCtx\(/g) || []).length;
  (ensureCalls65 >= 4 ? ok : fail)(
    `【65】三处 429 检测点都走 ensureRateLimitCtx（含定义共 ${ensureCalls65} 处）`
  );
  // ④ 兜底绝不放弃：拿不到原文就发续接指令
  (/const ctx = recoverRateLimitCtx\(threadId, turn\) \?\? \{[^]*?autoContinuePrompt\(\)/.test(appSrc65) ? ok : fail)(
    "【65】拿不到原文时退续接指令（绝不因为「没有登记」就放弃重试）"
  );
  // ⑤ 重试条按会话独立记录（用户要求「每个会话独立弹这个自动重试」）
  (/useState<Record<string, \{ attempt: number; retryAt: number \}>>\(\{\}\)/.test(appSrc65) ? ok : fail)(
    "【65】重试条状态按会话分别记录（多会话各记各的倒计时）"
  );
  (/\{ \.\.\.current, \[threadId\]: entry \}/.test(appSrc65) ? ok : fail)(
    "【65】每会话独立写入重试条（不再被最后一次覆盖）"
  );
}
}

{
{
  // ── 【66】安装/依赖获取全程不得弹出系统窗口（09-19 用户：「把这些初次安装依赖和工具改成
  //   不弹窗，全部，进度条展示吧，这样可视化进度，方便新手」）──
  //   根因：Electron 父进程**没有控制台**，子进程一旦用 stdio:"inherit"，Windows 会给它
  //   **新分配一个 cmd.exe 控制台窗口**（用户截图那个黑框）。
  //   真机验证（e2e 起真实应用 + 安装 yt-dlp + tasklist 采样窗口）：管道方案全程**零新增**
  //   cmd/conhost 窗口；percent 事件 0→100 共 124 条 → 界面进度条有真实数据。
  const stripComments66 = (src) => src.split(/\r?\n/).filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
  for (const rel of ["scripts/install-runtimes.cjs", "scripts/install-automation.cjs"]) {
    const src = stripComments66(readFileSync(join(ROOT, rel), "utf8"));
    (!/stdio:\s*"inherit"/.test(src) ? ok : fail)(
      `【66】${rel} 不得用 stdio:"inherit"（无控制台的父进程下会弹 cmd 黑窗）`
    );
    (!/\bexecSync\(/.test(src) ? ok : fail)(
      `【66】${rel} 不得直接用 execSync（缺 windowsHide；统一走 runCommand/runStreaming）`
    );
  }
  const runtimesSrc66 = readFileSync(join(ROOT, "scripts", "install-runtimes.cjs"), "utf8");
  (/windowsHide: true/.test(runtimesSrc66) ? ok : fail)(
    "【66】安装脚本的子进程显式 windowsHide"
  );
  (/@@PROGRESS/.test(runtimesSrc66) && /@@STAGE/.test(runtimesSrc66) ? ok : fail)(
    "【66】安装脚本上报结构化进度（@@PROGRESS / @@STAGE → 界面进度条）"
  );
  const mainSrc66 = readMainSource();
  (/function emitRuntimeProgress\(/.test(mainSrc66) && /percent: Math\.max\(0, Math\.min\(100/.test(mainSrc66) ? ok : fail)(
    "【66】主进程把进度行解析成 percent/stage 事件下发给界面"
  );
  const appSrc66 = readAppUi();
  (/className="runtime-progress-bar"/.test(appSrc66) ? ok : fail)(
    "【66】渲染层用进度条展示安装进度（卡片 / 安装弹窗）"
  );
  const cssSrc66 = readStyles();
  (/\.runtime-progress-bar\s*\{/.test(cssSrc66) ? ok : fail)(
    "【66】进度条样式存在"
  );
}
}

{
{
  // ── 【67】引擎保留 provider id 不得写进配置（09-19 真实用户 DELL 事故）──
  //   档案里 provider=openai → config.toml 写出 [model_providers.openai] → 引擎**整份拒载**：
  //   `model_providers contains reserved built-in provider IDs: openai`，用户发消息必报错，
  //   且与用哪个模型无关。四层防：① 独立模块提供改名；② 写档案/写配置统一改名；
  //   ③ 会话级 config 覆盖也改名（审查发现的漏点）；④ 启动自愈清掉已写坏的段。
  const providerIdSrc67 = readFileSync(join(ROOT, "electron", "provider-id.ts"), "utf8");
  (/RESERVED_PROVIDER_IDS/.test(providerIdSrc67) && /export function safeProviderId/.test(providerIdSrc67) ? ok : fail)(
    "【67】保留 provider id 处理模块存在（electron/provider-id.ts）"
  );
  (/export function stripReservedProviderTables/.test(providerIdSrc67) ? ok : fail)(
    "【67】提供清理保留段的工具（供启动自愈用）"
  );
  const mainSrc67 = readMainSource();
  (/\[model_providers\.\$\{tomlBareKey\(safeProviderId\(normalized\.provider\)\)\}\]/.test(mainSrc67) ? ok : fail)(
    "【67】生成 provider 段头时过 safeProviderId（保留 id 会被改名）"
  );
  (/\.map\(\(id\) => safeProviderId\(id\)\)/.test(mainSrc67) ? ok : fail)(
    "【67】历史会话别名 id 同样过 safeProviderId（防 duplicate key）"
  );
  (/void healReservedProviderConfig\(\)/.test(mainSrc67) ? ok : fail)(
    "【67】启动时自愈已写坏的配置（老用户升级后自动恢复）"
  );
  // 自愈必须看**原始文件**里的 provider —— readCustomModels() 回来的已经改名，比较恒 false（实测踩过死代码）
  (/const rawList: Array<\{ provider\?: string \}> = raw \? JSON\.parse\(raw\) : \[\]/.test(mainSrc67) ? ok : fail)(
    "【67】自愈按原始档案判断是否需要改名（不是按已归一化的结果）"
  );
  const calls67 = (mainSrc67.match(/model_provider: safeProviderId\(/g) || []).length;
  (calls67 >= 7 ? ok : fail)(
    `【67】会话级 config 覆盖也过 safeProviderId（${calls67} 处）`
  );
  /* 09-22：harness-services.ts 拆成 memory-store.ts + scheduler.ts（原文件是两个无关的域）⇒ 断言跟着搬 */
  for (const rel of ["electron/channel-bot.ts", "electron/scheduler.ts"]) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    (/model_provider: safeProviderId\(model\.provider\)/.test(src) ? ok : fail)(
      `【67】${rel} 的会话/子代理 config 同样过 safeProviderId`
    );
  }
}
}

{
{
  // ── 【68】不得把引擎重试参数调得比默认更激进（09-19 真实事故：429 越重试越频繁）──
  //   引擎默认 request_max_retries=4 / stream_max_retries=5 / stream_idle_timeout_ms=300000
  //   （codex-rs model-provider-info：DEFAULT_REQUEST_MAX_RETRIES / DEFAULT_STREAM_MAX_RETRIES）。
  //   曾写 10/10/600000 ⇒ 引擎在限流窗口内以 2~3 秒间隔密集重打上游 ⇒
  //   实测单个 turn 内 32 次 429、单个 submission 反复 exceeded retry limit，
  //   叠加应用层 10 次重试 = 最坏 100 倍请求放大（用户："WorkBuddy 用同一供应商完全没问题"）。
  //   ⇒ 现在一个键都不写（用引擎默认）。谁再加回来，构建阶段就红。
  const retrySrc68 = readFileSync(join(ROOT, "electron", "provider-retry.ts"), "utf8");
  // ⛔ 判据必须**剥掉注释**：该文件用注释详细记录了"曾写 10 是错的"这段历史，
  //   直接全文正则会把注释里的历史数值当成现役配置（实测踩过一次假红）。
  const retryCode68 = retrySrc68.split(/\r?\n/).filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
  (/export const PROVIDER_RETRY_TUNING = \{\} as const;/.test(retryCode68) ? ok : fail)(
    "【68】PROVIDER_RETRY_TUNING 必须为空（用引擎默认，不放大重试）"
  );
  (!/request_max_retries\s*[:=]\s*\d/.test(retryCode68) ? ok : fail)(
    "【68】provider-retry.ts 不得写死 request_max_retries 数值（代码区，不含注释）"
  );
  /* ⛔ 09-24 修：扫描前必须**剔注释** —— electron/provider-retry.ts:5 的说明文字里就写着
     `request_max_retries = 4`（那是在解释「引擎默认值」，属文档而非配置生成代码）。
     聚合面加宽把该文件纳入后，负向断言被这条注释顶成假红。断言本意就是「代码区不得写字面量」。 */
  const mainSrc68 = codeOnly(readMainSource());
  (!/request_max_retries = \d/.test(mainSrc68) ? ok : fail)(
    "【68】config.toml 生成处不得写 request_max_retries 字面量"
  );
  (!/stream_max_retries = \d/.test(mainSrc68) ? ok : fail)(
    "【68】config.toml 生成处不得写 stream_max_retries 字面量"
  );
  const rlSrc68 = readFileSync(join(ROOT, "src", "lib", "rate-limit-retry.ts"), "utf8");
  const maxMatch = rlSrc68.match(/RATE_LIMIT_MAX_ATTEMPTS = (\d+)/);
  (maxMatch && Number(maxMatch[1]) <= 8 ? ok : fail)(
    `【68】应用层重试次数保守（当前 ${maxMatch ? maxMatch[1] : "?"} 次，上限 8）`
  );
  const backoff = rlSrc68.match(/const BACKOFF_MS = \[([^\]]+)\]/);
  const first = backoff ? Number(String(backoff[1]).split(",")[0].trim()) : 0;
  (first >= 10000 ? ok : fail)(
    `【68】首次退避足够长（当前 ${first}ms，下限 10000ms —— 限流是分钟级窗口，靠等不靠多试）`
  );
}
}

{
{
  /* ── 【69】并发闸门已于 09-25 **整体删除**（用户：「直接把并发限制删了吧」）────────────
     被删的符号：`src/lib/concurrency.mjs`（concurrencyExceeded / normalizeMaxConcurrency / 两档常量）、
     part03 的 atConcurrencyLimit / notifyConcurrencyLimit / maxConcurrencyRef、
     主进程 `admitDispatch` / `maxConcurrentDispatch`、UI「最大并发」输入框。
     ⛔ 下面两条是**负向断言**（匹配前先过 codeOnly —— 注释里引用旧符号名不该把它顶成假红/假绿）：
        谁把并发限制加回来，预检直接红（用户 09-25 的明确要求是删除，不许悄悄复活）。
     ⛔ 上游限流仍由引擎默认重试/退避兜底（provider-retry.ts：一个重试键都不写）。 */
    const appUiCode69 = codeOnly(readAppUi());
    const mainSrc69 = codeOnly(readMainSource());
    (!/concurrencyExceeded|atConcurrencyLimit|normalizeMaxConcurrency|notifyConcurrencyLimit|maxConcurrencyRef/.test(appUiCode69) ? ok : fail)(
      "【69】⛔ 渲染层不得再有并发闸门的任何符号（用户 09-25 要求删除，不许悄悄复活）"
    );
    (!/admitDispatch|maxConcurrentDispatch|MAX_CONCURRENT_DISPATCH/.test(mainSrc69) ? ok : fail)(
      "【69】⛔ 主进程不得再有调度并发闸（L4 总量闸已删；L3 深度闸 canDispatchFrom 保留）"
    );

  /* ── 【159】默认值跨进程同源（09-25；压缩比例保留，并发档位已随闸门删除）──
     ⛔ `electron/` 与 `src/` 是**独立打包产物、互不 import**，所以「默认自动压缩比例」两侧各有一份
        字面量。改了主进程忘渲染层（或反过来）的症状是**静默偏半**：设置页显示 60%、主进程按 75% 写。
        跑绿也看不出来。
     ⛔ 判据取**字面量本身**（不是"含某个词"）—— 上一轮【150】就吃过「断言命中注释而非代码」的亏。
     ⛔ 并发档位已随闸门删除（见【69】），这里只剩压缩比例这一对。 */
  const ratioRenderer = ((readAppUi().match(/const AUTO_COMPACT_RATIO_DEFAULT = ([\d.]+);/) || [])[1]);
  const ratioMain = ((mainSrc69.match(/export const DEFAULT_AUTO_COMPACT_RATIO = ([\d.]+);/) || [])[1]);
  (ratioRenderer && ratioMain && ratioRenderer === ratioMain && Number(ratioRenderer) === 0.6 ? ok : fail)(
    `【159】默认自动压缩比例跨进程同源且为 0.6（渲染层 ${ratioRenderer} / 主进程 ${ratioMain}）`
  );
  /* ⛔ 反向：不能再有 `autoCompactRatio ?? 数字` 的裸默认（改了常量但某处仍写死 ⇒ 那一段 provider
     段的压缩阈值与设置页显示的不一致，而引擎按会话实际用的段取值 = 静默偏半）。
     ⛔ 判据必须**带上 autoCompactRatio**：裸匹配 `?? 0.8` 会命中无关代码（语音 asr rule2、
     记忆 confidence 都有 `?? 0.8`）—— 第一版就这么写真红了，属「断言比文案宽」的典型。 */
  (!/autoCompactRatio \?\? [\d.]+/.test(mainSrc69) ? ok : fail)("【159】主进程不再有 `autoCompactRatio ?? 数字` 裸默认（全走 normalizeAutoCompactRatio）");
  (/n < 0\.1 \|\| n > 0\.95/.test(mainSrc69) ? ok : fail)(
    "【159】压缩比例下限 = 0.1（10-07 放宽：低比值用于实测运行中自动压缩；⛔ 不许退回 0 值区 —— 阈值变 0 会每轮都压）");
  (/normalizeAutoCompactRatio\(appSettings\.autoCompactRatio\)/.test(mainSrc69) ? ok : fail)(
    "【159】压缩阈值经归一化（0 / 负数 / 越界会被挡下 —— 否则阈值变 0，引擎每轮都压缩）"
  );
  /* ⛔ 10-07 事故（用户设置恒不生效）：app-settings 缓存必须按**文件路径**归属 ——
     userData 重定向（app.setPath）之前的调用读过默认目录，读失败的空对象曾被缓存整个进程
     （`if (cached)` 短路）⇒ 自动压缩比例等全部用户设置静默失效（config.toml 恒默认阈值）。
     判据锚**语句本身**：两条读取路径都必须 `cached && cachedFor === file`、保存路径同款。 */
  const keyedReads159 = (mainSrc69.match(/if \(cached && cachedFor === file\) return cached;/g) || []).length;
  const keyedSave159 = /const current = cached && cachedFor === file \? cached : await readAppSettings\(userData\);/.test(mainSrc69);
  (keyedReads159 === 2 && keyedSave159 ? ok : fail)(
    `【159】app-settings 缓存按文件路径归属（读取 ${keyedReads159}/2 处、保存 ${keyedSave159 ? "已" : "未"}接 —— ⛔ 退回裸 if(cached) 会把重定向前的空读短路到整个进程）`
  );
  /* ⛔ 压缩阈值必须纳入**启动自愈的漂移判据**（09-25 code review 抓到）：
     config.toml 里的阈值是**写下来就不再变**的（除非有人重写整份配置）。只改设置 / 只改默认值
     都不会触发上面任何一条既有判据 ⇒ 旧阈值一直生效 = 用户看到的「改了没生效」。
     判据要同时锚「算期望值」与「接进 if 条件」两处 —— 只验前者会漏掉"算出来了但没接"。 */
  (/const expectedCompact = Math\.round\(compactWindow \* normalizeAutoCompactRatio\(/.test(mainSrc69) ? ok : fail)(
    "【159】启动自愈会算「期望压缩阈值」（与 applyCustomModel 同源算法）"
  );
  (/\|\| dispatchMcpBad \|\| compactStale \|\| compactKeyResidue\)/.test(mainSrc69) ? ok : fail)(
    "【159】压缩阈值漂移**接进了重写条件**（只算不接 = 恒不做，等于没有这条判据；09-28 追加 provider 段旧键残留判据 compactKeyResidue 一并挂链）"
  );
}
}
}
