/**
 * openThread 的**实现**（09-22 从 01-seg.tsx 整函数外提，纯搬迁、零改写）。
 *
 * ⛔ 原函数对宿主局部绑定的闭包 = 0（跨段依赖全走 bag）⇒ 只需补一个 `bag` 首参，函数体逐字照搬。
 * ⛔ 宿主里留同名薄壳转调，调用点与函数提升语义都不变。
 */
import "@xterm/xterm/css/xterm.css";
import { loadDraft, saveDraft } from "../../../../../lib/composer-draft.mjs";
import { DEFAULT_EFFORT, pickDefaultEffort, normalizeEffort, ALL_EFFORTS, declaredModelEfforts } from "../../../../../lib/effort";
import { ALIGN_RESULT, CONTINUITY_TEXT, HARNESS_PROVIDER_ID, shouldAlignProvider } from "../../../../../lib/provider-continuity.mjs";
import { contentOffsetTop, jumpToBottom, scrollToOffsetInstant } from "../../../../../components/scroll-utils";
import { classifyUnit, buildSegments, buildOrderedToolRuns, foldItemStatus, computeFoldSummary, topToolGroup, isTurnRunning, normalizeLoadedThread, type FoldUnit } from "../../../../../lib/turn-fold";
import { Turn } from "../../../../../lib/turn";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../../app-view/types";
import type { Bag } from "../../bag-types";

export async function openThread(bag: Bag, id: string, freshThread?: Thread | null) {
    bag.switchStartRef.current = performance.now();
    // 新会话：重新等待「真实用户滚动」才允许自动续载（见 userScrolledRef）
    bag.userScrolledRef.current = false;
    bag.setEarlierLoadingId(null); // 切会话不留上一次的「正在载入更早」提示
    bag.setChatSearchOpen(false);
    // 快速连点防竞态：只有最新一次切换的 resume 响应才允许落地渲染
    const seq = ++bag.switchSeqRef.current;
    bag.setOpeningThread(id);
    // ⛔ 输入框草稿按会话保存（09-19）：切走前把当前会话的草稿存下，再恢复目标会话的草稿
    //   （同一会话重复点击不动作；草稿是「打完一半切走、切回来还在」的关键）
    if ((bag.threadRef.current?.id ?? null) !== id) {
      saveDraft(bag.threadRef.current?.id ?? null, bag.promptRef.current);
      bag.draftJustRestoredRef.current = true;   // 恢复值来自该键，无需写回；且防抖此刻会写错键
      bag.setPrompt(loadDraft(id));
    }
    // 记住本次打开的会话：重启后据此恢复（否则停在欢迎页，一发消息就新建空会话）
    try { localStorage.setItem("last-thread", id); } catch { /* 隐私模式等：忽略 */ }
    // 模型回填：**该会话自己的记录优先**，它还没有记录（新建/从没选过）才用全局默认。
    // 这就是「每个会话独立选模型」——切到哪个会话就亮哪个会话的模型，互不串扰；
    // 改全局默认也只影响新会话与**当时打开的那一个**会话（规则见 src/lib/model-scope.mjs）。
    const storedModel = resolveThreadModel(id);
    if (storedModel) bag.setModelId(storedModel);
    // ⛔ 旧会话种子烙印（09-13）：改动前的旧会话没有 thread-model-<id> 记录（回填走全局
    // 兜底 = 还留着一根被「其他会话改全局默认」污染的口子）。首次打开时把当时的生效值
    // 烙成它自己的记录，此后该会话与新会话一样完全走会话级。
    if (!storedModel) saveThreadModel(id, bag.modelId);
    // 与主进程对齐（多窗口并发保护，09-14）：主进程有记录则以它为准（含 rev），没有就把本地值播种上去。
    // 不 await：切会话是热路径（秒开），一次 IPC 往返不值得塞进等待链；主进程值晚到一拍时由
    // admitThreadRuntime 收敛界面与镜像。
    void bag.syncThreadRuntimeWithMain(id);
    // 切会话过渡遮罩：只在「没有缓存、需要真正加载」时显示（首次打开的长会话）。
    // 缓存秒开的会话不再强制遮罩——WorkBuddy 式直切（缓存直渲 + 后台 resume 对齐），
    // 每次切换都白遮 ~200ms 是「切换不够丝滑」的直接观感来源。
    if (!bag.threadCacheRef.current.get(id)) bag.setSwitchingThreadId(id);
    // 切换诊断（09-14）：这一笔是「冷加载」还是「命中缓存」，以及缓存里有几轮内容——
    // 结算时一并写进 __adbg，accept switch-perf 靠它区分两条曲线。
    bag.switchModeRef.current = bag.threadCacheRef.current.get(id) ? "cached" : "fresh";
    bag.switchTurnsRef.current = bag.threadCacheRef.current.get(id)?.turns.length ?? 0;
    bag.setMobileNav(false);
    bag.setDiff("");
    bag.setSystemEvents([]);
    bag.setOptimisticInput(null);
    // ★ 切会话时的锚定状态处理（09-13 用户实测：「切换会话，钉顶没了」）。
    //   钉顶**跟着它所属的会话活着**：切到别的会话时它只是"休眠"（不生效、也不销毁），
    //   切回来时由 pinSentMessage 复核并恢复落点；清空只发生在用户接管 / 新的一次发送。
    //   这里只需要把留白归零：别的会话不该看到这条会话的锚顶留白，而切回来时
    //   pinSentMessage 会按需重新撑起来。
    //   （曾经在这里无条件清 anchorTopRef —— 于是"切出去看一眼再切回来"钉顶就没了、
    //    视口掉到底部，正是用户报的这个现象。）
    bag.clearAnchorPad();
    const knownRunning = bag.runningThreadIdsRef.current.has(id);
    bag.setSending(knownRunning);
    bag.setActiveTurnId(knownRunning ? (bag.runningTurnIdsRef.current.get(id) ?? null) : null);
    bag.setWorkStartedAt(knownRunning ? (bag.runningStartedAtRef.current.get(id) ?? Date.now()) : null);
    bag.setInterrupting(false);
    // 切会话后滚动位置属于旧会话，不能带过来；等新内容渲染后直接跳到最新消息。
    // ★ 09-14：离开前先把「旧会话的阅读位置」记下来（距底偏移），命中缓存切回时据此还原——
    //   原先无条件跳底，用户切出去看一眼再切回来会丢掉正在读的位置（WorkBuddy 靠缓存保住它）。
    bag.rememberScrollPosition(bag.threadRef.current?.id ?? "");
    bag.switchJumpRef.current = { id, at: Date.now() };
    // 渲染窗口：**命中缓存则保留上次展开的深度**（切回刚看过的长会话不该把内容缩回去），
    // 冷加载才重置——重置的意义是「切换成本与会话历史长度无关」，冷加载本来就没内容。
    const keepWindow = Boolean(bag.threadCacheRef.current.get(id));
    if (!keepWindow && (bag.turnWindowRef.current[id] ?? bag.TURN_WINDOW) !== bag.TURN_WINDOW) {
      bag.turnWindowRef.current = bag.touchTurnWindow(id, { ...bag.turnWindowRef.current, [id]: bag.TURN_WINDOW });
      bag.setTurnWindow(bag.turnWindowRef.current);
    } else {
      bag.turnWindowRef.current = bag.touchTurnWindow(id, bag.turnWindowRef.current);
    }
    bag.closeTaskMenu();
    bag.setReviewBusy(false);
    bag.setReviewReport("");
    bag.reviewTurnRef.current = null;
    bag.setPlanSteps([]);
    bag.setGoalText("");
    bag.setGoalStatus(null);
    // 目标模式状态回填：切会话后从引擎拉当前 goal（引擎原生自动续跑的依据）
    void window.codex.request("thread/goal/get", { threadId: id }).then((result) => {
      if (bag.switchSeqRef.current !== seq) return;
      bag.setGoalText(result.goal?.objective ?? "");
      bag.setGoalStatus(result.goal?.status ?? null);
    }).catch(() => { /* 引擎不支持 goal RPC 时静默 */ });
    // jumpToBottom settled 回调：内容渲染稳定（scrollHeight 连续两帧不变）后才让遮罩
    // 淡出；多次调用重置 timer，保证只有"所有路径的 jumpToBottom 都稳定"后才真正卸载，
    // 避免切到长会话时遮罩提前消失、内容继续增高导致"切过去在中间"。
    const markSettled = () => {
      // ⛔ 15 秒硬超时兜底（09-15 用户实测「打开会话全白」）：遮罩的消失完全依赖
      // markSettled→jumpToBottom→「scrollHeight 连续两帧不变」。大会话（25 回合）冷加载时
      // content-visibility 逐段回填高度、或后台流式让高度持续变化，jumpToBottom 可能长时间
      // 不 settled → 遮罩永久挂住 = 整片白屏。无论如何 15 秒后强制淡出（内容随后自己就位）。
      if (bag.switchHardTimerRef.current == null) {
        bag.switchHardTimerRef.current = window.setTimeout(() => {
          bag.switchHardTimerRef.current = null;
          if (seq !== bag.switchSeqRef.current) return;
          bag.setSwitchingThreadId((current) => (current === id ? null : current));
          bag.setSwitchingFading(false);
        }, 15000);
      }
      if (seq !== bag.switchSeqRef.current) return;
      if (bag.fadeOutTimerRef.current != null) window.clearTimeout(bag.fadeOutTimerRef.current);
      bag.setSwitchingFading(true);
      bag.fadeOutTimerRef.current = window.setTimeout(() => {
        if (seq !== bag.switchSeqRef.current) return;
        bag.setSwitchingThreadId((current) => (current === id ? null : current));
        bag.setSwitchingFading(false);
        bag.fadeOutTimerRef.current = null;
        if (bag.switchHardTimerRef.current != null) { window.clearTimeout(bag.switchHardTimerRef.current); bag.switchHardTimerRef.current = null; }
      }, 180);
    };
    // 新建线程（主进程已 thread/start + turn/start）：本地直接落地，不走 resume——
    // 刚建的线程还没有 rollout，thread/resume 必报 "no rollout found"，会让界面掉回欢迎页。
    if (freshThread) {
      if (seq !== bag.switchSeqRef.current) return;
      // 新建线程（含「导入会话记录」建的空会话）本地落地时也贴一次名字覆盖：
      // 这条链上引擎侧那份名字要么没有（无回合 ⇒ 不在 thread/list），要么会被首条消息顶掉。
      const fresh = bag.withNameOverride(freshThread);
      bag.threadRef.current = fresh;
      bag.threadCacheRef.current.set(id, fresh);
      bag.setThread(fresh);
      const initialModel = storedModel || bag.modelId || localStorage.getItem("default-model") || "";
      if (initialModel) {
        bag.setModelId(initialModel);
        saveThreadModel(id, initialModel);
      }
      bag.switchJumpRef.current = { id, at: Date.now() };
      // 线程已按当前用户偏好建好（调用方传入 sandbox/approvalPolicy），直接固化本地权限记录
      bag.setSandbox(bag.sandbox);
      bag.setApprovalPolicy(bag.approvalPolicy);
      saveThreadPermissions(id, bag.sandbox, bag.approvalPolicy);
      // 切回一个「引擎仍在后台运行」的会话时，点亮它的侧边栏转圈（跟当前选中解耦）。
      // ⛔ 绝不用「快照里没看到 running 回合」来**熄灭**运行状态（09-19 用户：「切会话/开关独立窗口，
      //   正在跑的任务莫名停止」，这是真根因之一）：
      //   引擎 resume 回包与本地缓存快照经常**不带** inProgress 回合（或带的是旧快照），据此清账会
      //   把真正在跑的会话判成已停 ⇒ 停止键消失、侧栏转圈消失，而且**下一条消息会走 `turn/start`**
      //   ⇒ 引擎侧那个回合被当场打断。撤销运行态只能靠**回合级权威事件**
      //   （turn/completed|aborted|failed|interrupted）或引擎侧记账核实（见 status/changed idle 分支）。
      // ⛔⛔ 反向同样要防（09-19 截图「运行状态一直不结束」）：freshThread 快照对刚完成的回合
      //   可能滞后（status 仍 inProgress）——点亮前与引擎侧记账核实，同 resume 主路径。
      const runningTurn = (freshThread.turns ?? []).find((turn: Turn) => isTurnRunning(turn));
      bag.setActiveTurnId(runningTurn?.id ?? null);
      bag.setSending(Boolean(runningTurn));
      bag.setWorkStartedAt(runningTurn ? (bag.runningStartedAtRef.current.get(id) ?? Date.now()) : null);
      if (runningTurn) {
        const probeThreadId = id;
        void window.codex.engineActiveTurns().then((info) => {
          if ((info?.threadIds ?? []).map(String).includes(probeThreadId)) {
            bag.markThreadRunning(probeThreadId, runningTurn.id);
          } else if (bag.runningThreadIdsRef.current.has(probeThreadId)) {
            bag.markThreadStopped(probeThreadId);
          }
        }).catch(() => {
          // 核实失败：保守点亮（同 resume 主路径的取舍）
          bag.markThreadRunning(probeThreadId, runningTurn.id);
        });
      }
      // 工作区与线程一致（团队卡片可指定独立项目地址）；用户改过地址时以本地覆盖为准
      const liveCwd = bag.effectiveCwd(freshThread.id, freshThread.cwd);
      if (liveCwd) bag.setWorkspace(liveCwd);
      // 内容渲染完成后瞬时定位到最新消息（两帧重试；带 settled 回调确保遮罩等渲染稳定）
      requestAnimationFrame(() => requestAnimationFrame(() => jumpToBottom(bag.scrollRef.current, markSettled, bag.contentTailTarget)));
      bag.setOpeningThread(null);
      markSettled();
      return;
    }
    // 缓存秒开：打开过的会话立即渲染缓存内容（最新消息已在屏），resume 在后台刷新
    const cached = bag.threadCacheRef.current.get(id);
    if (cached) {
      // 已知仍在后台运行的会话不能做“历史残留运行态归一化”，否则切回来会先
      // 被误改成 completed，随后 resume 又改回 running，造成状态机闪烁甚至错乱。
      const normalizedCache = bag.runningThreadIdsRef.current.has(id) ? cached : normalizeLoadedThread(cached);
      if (normalizedCache !== cached) bag.threadCacheRef.current.set(id, normalizedCache);
      bag.threadRef.current = normalizedCache;
      bag.setThread(normalizedCache);
      const cachedRunningTurn = normalizedCache.turns.find((turn: Turn) => isTurnRunning(turn));
      bag.setActiveTurnId(cachedRunningTurn?.id ?? null);
      bag.setSending(Boolean(cachedRunningTurn));
      bag.setWorkStartedAt(cachedRunningTurn ? (bag.runningStartedAtRef.current.get(id) ?? Date.now()) : null);
      if (cachedRunningTurn) bag.markThreadRunning(id, cachedRunningTurn.id);
      // layout effect 会消费 switchJumpRef 瞬时滚到底；这里再兜底一次（带 settled 回调），
      // 防 markdown/图片在首帧后增高导致没贴底
      requestAnimationFrame(() => jumpToBottom(bag.scrollRef.current, markSettled, bag.contentTailTarget));
    }
    // 频繁切换优化：缓存已秒开、该会话不在运行、且 30 秒内刚完整 resume 过 → 跳过这轮
    // resume。反复切换时每次都全量加载是卡顿主因；非运行会话期间无事件流，内容不可能变化。
    // 运行中会话必须继续走 resume 对齐引擎状态，不能跳。
    // ⛔ 例外（09-19）：needsFullReloadRef 里的会话**必须** resume —— 它的缓存缺整轮内容
    //   （后台完成时只拿到产出条目，连用户消息都没有），跳过 resume 会渲染出孤儿回复。
    if (cached && !knownRunning && !bag.needsFullReloadRef.current.has(id) && Date.now() - (bag.recentResumeAtRef.current.get(id) ?? 0) < 30_000) {
      bag.recentResumeAtRef.current.set(id, Date.now());
      bag.setOpeningThread(null);
      return;
    }
    try {
      // resume 必带沙箱（schema 实证 resume 接受 sandbox 字符串）：引擎重启后 resume 不带
      // sandbox 会把线程权限重置成 workspace-write+restricted（实证 rollout 07:19:54，
      // 「完全访问静默失效」的真根因）。本地有用户选择用之，否则用全局默认。
      const permForResume = loadThreadPermissions(id);
      const resumeSandbox = permForResume.sandbox === "danger-full-access" || permForResume.sandbox === "read-only" || permForResume.sandbox === "workspace-write"
        ? permForResume.sandbox
        : (localStorage.getItem("default-sandbox") ?? "danger-full-access");
      const resumeApproval = permForResume.approval === "never" || permForResume.approval === "on-request" || permForResume.approval === "untrusted"
        ? permForResume.approval
        : (localStorage.getItem("default-approval") ?? "never");
      // 轻量 resume（excludeTurns:true + 最新一页回合）：不再让引擎全量水合几千个回合——
      // 这是切会话慢的数据侧主因；更早的历史由「显示更早的消息」按需续拉
      // resume 必带当前动态工具面：引擎 resume schema 接受 dynamicTools，恢复会话时
      // 重注册——旧会话（创建于新工具上线前）也能用上 skill_search 等新增工具
      const dynamicTools = await bag.buildDynamicTools();
      const result = await bag.resumeThreadLight({ threadId: id, sandbox: resumeSandbox, approvalPolicy: resumeApproval, dynamicTools });
      // 残留运行态归一化（详见 normalizeLoadedThread）：旧会话丢过 turn/completed 的
      // 回合不能带着 inProgress 进渲染，否则永远走流式分支、展示回退到旧效果。
      // 回包的 name 是引擎那一份（会被该会话第一条用户消息顶掉）⇒ 贴本地覆盖，用户改过的名字要赢
      const loadedRaw = bag.runningThreadIdsRef.current.has(id) ? result.thread : normalizeLoadedThread(result.thread);
      const loaded = loadedRaw ? bag.withNameOverride(loadedRaw) : loadedRaw;
      // 运行中会话：resume 快照可能落后于本地流式积累（切走期间 delta 仍在更新内存）。
      // 整体替换会让正文回退、随后 delta 从快照点重新追加 = 出字动画重放。逐 item 取更长的流式文本。
      const mergedLoaded = cached && loaded ? mergeLongerStreams(cached, loaded) : loaded;
      // ★ 缓存**先写、再判 seq**（09-17 修「切换会话卡顿」）：
      //   ⛔ 原先 seq 校验排在写缓存之前 —— 用户快速连切 A→B→C 时，A、B 的 resume 结果
      //   在「已切走」这行被整个丢弃，缓存里一个都没留下，于是**下次切回仍是冷加载**。
      //   实测（switch-speed 场景）：4 次「再切回」里只有 1 次命中缓存，cached.n=1 / fresh=8；
      //   而命中缓存只需 9ms、冷加载 200ms —— 这正是用户说的「切换会话卡顿一下」。
      //   结果已到手就该留下：切走了只是不许它动视图，不是不许它进缓存。
      if (seq !== bag.switchSeqRef.current) {
        // 已切走：视图不动，但结果入缓存（否则下次切回仍是冷加载）。
        // 加固：与缓存里已有的那份再合一次（mergeLongerStreams 取更长的流式文本）——
        // 同一会话并发两次 resume 时，后到的旧结果不会把已存的新内容顶短。
        const existing = bag.threadCacheRef.current.get(id);
        bag.threadCacheRef.current.set(id, existing && existing !== mergedLoaded ? mergeLongerStreams(existing, mergedLoaded) : mergedLoaded);
        return;
      }
      bag.recentResumeAtRef.current.set(id, Date.now());
      bag.needsFullReloadRef.current.delete(id);   // resume 已拿全内容：清掉「必须重载」标记
      bag.threadCacheRef.current.set(id, mergedLoaded);
      bag.threadRef.current = mergedLoaded;
      // 秒开后 resume 无实质变化时不替换（避免闪烁）；有变化（后台继续跑/消息补齐）才更新
      const changed = !cached || threadContentChanged(cached, mergedLoaded);
      if (changed) {
        // 内容补齐会再次渲染：重设 switchJump，让这次渲染也瞬时定位（否则 smooth 动画
        // 又会从中间滑到底部，且动画目标基于渲染瞬间的 scrollHeight，易停在半路）
        bag.switchJumpRef.current = { id, at: Date.now() };
      }
      // 历史内容即使没有数据变化，也重新提交一次，让旧会话应用当前折叠标题与样式。
      bag.setThread(mergedLoaded);
      // 内容渲染完成后再次瞬时定位到最新消息（两帧重试，等 React 提交 DOM；带 settled
      // 回调——markSettled 会重置 fade-out timer，确保遮罩等到所有路径都跳完才淡出）
      requestAnimationFrame(() => requestAnimationFrame(() => jumpToBottom(bag.scrollRef.current, markSettled, bag.contentTailTarget)));
      const resultProvider = String(result.modelProvider ?? result.model_provider ?? bag.customModel?.provider ?? "custom");
      // 记录会话真实绑定的供应商（迁移成功后 migrateThreadToProvider 会覆盖为新值）
      bag.threadProviderRef.current.set(id, resultProvider);
      // 09-14 用户定稿（打开即自动对齐 / 「自动接力」）：引擎自发的上下文压缩、重连都不等
      // 发送动作 —— 只在发送前迁移的话，旧绑定会在用户刚打开会话时就撞 401（用户实测
      // 「切供应商后旧会话用不了」）。打开瞬间即对齐，之后一切（含引擎自发行为）都走新供应商。
      // 不 await：打开动作不被迁移阻塞；绑定已一致时零开销。
      const activeNow = bag.activeProviderRef.current ?? (bag.customModel
        ? { provider: bag.customModel.provider, model: bag.customModel.model, name: bag.customModel.name, baseUrl: bag.customModel.baseUrl, wireApi: bag.customModel.wireApi }
        : null);
      // 即将自动接力（会话绑定 ≠ 当前激活）：下面对齐要用，模型回填也要用（见 restoredModel）。
      const willRealign = shouldAlignProvider(resultProvider, activeNow?.provider);
      {
        // 运行中的会话不打断：它刚跑起来，绑定的就是当前供应商。
        if (willRealign && activeNow && !bag.autoMigratedRef.current.has(id) && !bag.runningThreadIdsRef.current.has(id)) {
          bag.autoMigratedRef.current.add(id);
          // ⛔ silent：打开会话时的对齐**不提示**——引擎侧会话绑定是创建时固定的，切过一次供应商后
          // 每个旧会话都会「绑定 ≠ 激活」，若每次都弹「已自动接力」就成了「点一次会话提醒一次」
          // （用户 09-14 实测）。提示只留给用户真有动作/真出问题的路径（切换供应商 / 发送 / 引擎 401）。
          void bag.alignThreadToProvider(id, { provider: activeNow.provider, model: activeNow.model, name: activeNow.name, baseUrl: activeNow.baseUrl, wireApi: activeNow.wireApi }, { reason: "open", silent: true })
            .then((r) => { if (r === ALIGN_RESULT.failed) bag.autoMigratedRef.current.delete(id); })
            .catch(() => bag.autoMigratedRef.current.delete(id));
        }
      }
      const resultModel = String(result.model ?? "").trim();
      // ⛔ 先读一次镜像（而不是复用上面捕获的 storedModel）：syncThreadRuntimeWithMain 可能刚
      // 把主进程的权威值写进镜像，复用旧变量会用本地旧值把对方的改动覆盖回去（丢更新）。
      // 即将自动接力时，模型回填直接取激活模型：该会话记录马上就要被迁移改写成新供应商模型，
      // 这里若先写回旧记录，异步迁移完成后会被旧值覆盖回去（丢更新）。
      const restoredModel = willRealign && activeNow
        ? `custom:${activeNow.provider}:${activeNow.model}`
        : (loadThreadModel(id) || storedModel || (resultModel ? `custom:${resultProvider}:${resultModel}` : bag.modelId || localStorage.getItem("default-model") || ""));
      if (restoredModel) {
        bag.setModelId(restoredModel);
        saveThreadModel(id, restoredModel);
      }
      if (result.reasoningEffort) bag.setEffort(result.reasoningEffort);
      // 思考等级恢复优先级：本地每会话记录（用户在这个会话明确选过）> resume 回带值。
      // 引擎 resume 返回的是会话创建时的 effort，通常更旧；本地记录才是用户最新的选择。
      {
        const localEffort = loadThreadEffort(id);
        if (localEffort) bag.setEffort(localEffort);
        else if (!result.reasoningEffort) bag.setEffort(normalizeEffort(localStorage.getItem("default-effort")) || "");
        saveThreadEffort(id, localEffort || result.reasoningEffort || bag.effort || "");
        // ⛔ 旧会话种子烙印（09-13）：本地没有记录且引擎也没带时，把刚回填的生效值烙成
        // 该会话自己的记录——旧会话与新会话一样，此后不再读全局默认。
        if (!localEffort && !result.reasoningEffort) {
          const seeded = loadThreadEffort(id);
          if (!seeded && bag.effort) saveThreadEffort(id, bag.effort);
        }
      }
      // 打开会话后工作区跟随该会话的 cwd（会话创建时锁定的项目目录）；
      // 用户在这个会话里显式改过地址 ⇒ 以本地覆盖为准（否则顶栏会显示引擎那个旧目录）
      bag.setWorkspace(bag.effectiveCwd(id, result.cwd));
      // 权限恢复优先级：本地每任务记录（用户在这个会话明确选过）> 全局默认 > resume 响应。
      // 引擎 resume 返回的是会话创建时的值，通常是旧默认，不能覆盖用户当前的全局选择。
      const resumedSandbox = sandboxMode(result.sandboxPolicy ?? result.sandbox ?? (result.thread as any)?.sandboxPolicy);
      const resumedApproval = typeof result.approvalPolicy === "string" ? result.approvalPolicy : undefined;
      const localPerms = loadThreadPermissions(id);
      const validSandbox = (value?: string) => value === "danger-full-access" || value === "read-only" || value === "workspace-write" ? value : null;
      const validApproval = (value?: string) => value === "never" || value === "on-request" || value === "untrusted" ? value : null;
      const savedDefault = validSandbox(localStorage.getItem("default-sandbox") ?? undefined) ?? "danger-full-access";
      const savedDefaultApproval = validApproval(localStorage.getItem("default-approval") ?? undefined) ?? "never";
      // 优先级（09-10 修正「重启后审批档变成变更前确认」）：**用户当前的全局选择权威**。
      // 引擎 resume 返回的是会话创建时的旧档位（resumed），此前被排在全局默认前面——
      // 会话建在「变更前确认」上，就永远回不到用户后来选的档位。
      // ⛔ 「记录 == 引擎值 且 ≠ 全局默认 ⇒ 判定污染」这个启发式**必须消失**（09-13 审计 P0）：
      // resume 时正是拿本地记录当参数发给引擎，引擎必然原样回带 ⇒ 判据恒真 ⇒ `nextSandbox`
      // 落到全局默认，而首启默认是 `danger-full-access`/`never` —— 于是**用户为某会话显式选的
      // 只读被静默改成完全访问**（反向亦然）。这是安全方向上的静默降级，比"档位不够宽松"严重得多。
      // 现在的规则：**取两者中更保守的一个**。
      //   · 记录是用户显式选的只读（本次默认是全权）→ 只读 ✓；
      //   · 记录被旧版本污染成全权（本次默认是只读）→ 只读 ✓（用户的新默认也生效）；
      //   · 用户显式选全权但全局默认是只读 → 得到只读（**代价是这次的显式选择不生效**，
      //     但失败方向是"更严"而不是"更松"——权限类问题一律往安全侧倒）。
      const SANDBOX_SAFETY: Record<string, number> = { "read-only": 0, "workspace-write": 1, "danger-full-access": 2 };
      const APPROVAL_SAFETY: Record<string, number> = { untrusted: 0, "on-request": 1, never: 2 };
      const saferSandbox = (a: string | null, b: string) => (a && SANDBOX_SAFETY[a] != null && SANDBOX_SAFETY[a] < (SANDBOX_SAFETY[b] ?? 2)) ? a : b;
      const saferApproval = (a: string | null, b: string) => (a && APPROVAL_SAFETY[a] != null && APPROVAL_SAFETY[a] < (APPROVAL_SAFETY[b] ?? 2)) ? a : b;
      const nextSandbox = saferSandbox(validSandbox(localPerms.sandbox), savedDefault);
      const nextApproval = saferApproval(validApproval(localPerms.approval), savedDefaultApproval);
      bag.setSandbox(nextSandbox);
      bag.setApprovalPolicy(nextApproval);
      // 不再把解析结果回写本地记录：回写会把引擎旧值烙进记录，导致用户之后改全局默认
      // 对该会话永不生效。记录只由用户的显式操作（权限胶囊/审批选择）写入。
      // 权限不一致自愈：UI 呈现值与引擎真实值不同 → push 纠正（沙箱与审批任一不同都纠正）。
      if ((resumedSandbox && nextSandbox !== resumedSandbox) || (resumedApproval && nextApproval !== resumedApproval)) {
        void bag.pushThreadPermissions(id, nextSandbox, nextApproval).catch(() => undefined);
      }
      // 会话作用域下发（09-14）：把本会话**解析后的**会话级取值写进会话自己的 instructions，
      // 让会话里的模型能回答「我当前是什么模型 / 档位 / 权限」。必须显式传值——此刻
      // setModelId/setEffort/setSandbox 都还没提交，直接读 React 状态会拿到**上一个会话**的值
      // （那会把 A 的模型烙进刚打开的 B，正是要根治的串扰）。
      void bag.pushSessionScope(id, {
        model: modelName(restoredModel) || modelName(bag.modelId),
        provider: restoredModel.startsWith("custom:") ? restoredModel.split(":")[1] : resultProvider,
        effort: loadThreadEffort(id) || String(result.reasoningEffort ?? "") || bag.effort || "",
        sandbox: nextSandbox,
        approval: nextApproval,
      });
      const resumedRunningTurn = loaded.turns.find((turn: Turn) => isTurnRunning(turn));
      bag.setActiveTurnId(resumedRunningTurn?.id ?? null);
      bag.setSending(Boolean(resumedRunningTurn));
      bag.setWorkStartedAt(resumedRunningTurn ? (bag.runningStartedAtRef.current.get(id) ?? Date.now()) : null);
        // 切回一个「引擎仍在后台运行」的会话时，点亮它的侧边栏转圈（跟当前选中解耦）。
        // ⛔ 这里同样**不许**用快照熄灭（同上面 freshThread 分支的注释：快照不可靠，熄灭只能由
        //   回合级权威事件或引擎侧核实触发）。`resumedRunningTurn` 为假只说明"这份快照没告诉我们它在跑"，
        //   不等于"它没在跑"——把两者混为一谈正是"切会话把运行中的任务判死"的那条路径。
        // ⛔⛔ 反向同样要防（09-19 用户截图实证「运行状态一直不结束」）：resume 快照对**刚完成**
        //   的回合可能滞后（rollout 回放时 status 仍是 inProgress）——点亮前先与**引擎侧记账**
        //   核实：记账里没有该会话的活动回合 = 快照滞后，不点亮。这与 status/changed idle
        //   分支的「与引擎侧真相核对后才熄灭」是同一条不变量的两个方向：**快照两个方向都不可信，
        //   引擎侧记账才是唯一权威**。不核实的话：点亮后没有任何 turn/completed 会再来熄灭它
        //   （事件早已错过）→ 转圈永远挂着 → 用户以为任务还在跑。
        if (resumedRunningTurn) {
          const probeId = id;
          void window.codex.engineActiveTurns().then((info) => {
            if ((info?.threadIds ?? []).map(String).includes(probeId)) {
              bag.markThreadRunning(probeId, resumedRunningTurn.id);
            } else if (bag.runningThreadIdsRef.current.has(probeId)) {
              // 已被别处点亮（如 turn/started 事件先到）：快照滞后确认，熄灭
              bag.markThreadStopped(probeId);
            }
            // 两个分支都不命中 = 本来就没点亮，无需动作
          }).catch(() => {
            // 核实失败（引擎忙/桥断）：保守点亮——误点亮会被后续权威事件熄灭，
            // 而漏点亮会破坏「切回在跑会话亮转圈」的主路径
            bag.markThreadRunning(probeId, resumedRunningTurn.id);
          });
        }
    } catch (error: any) {
      if (seq === bag.switchSeqRef.current) {
        // 空会话（专家/团队 defer 预建、尚无 rollout）在引擎侧没有可 resume 的记录：
        // 用本地列表条目兜底渲染成空会话（欢迎页），用户可继续输入首条消息——角色提示由
        // localStorage 的 pending role 恢复，首条发送仍会包装成 SYSTEM TASK。
        if (/no rollout found|not found|no such thread|unloaded/i.test(String(error?.message))) {
          // 归档刚恢复的会话此时还不在 threads 列表里（refreshThreads 可能尚未提交），
          // 不依赖列表条目，直接构造最小空会话兜底渲染——用户可继续输入首条消息。
          const entry = bag.threads.find((t) => t.id === id);
          const local: Thread = { id, name: entry?.name ?? null, preview: "", cwd: entry?.cwd ?? bag.workspace ?? "", updatedAt: entry?.updatedAt ?? Date.now(), status: null, turns: [] };
          bag.threadRef.current = local;
          bag.threadCacheRef.current.set(id, local);
          bag.setThread(local);
          bag.setSending(false);
          bag.setActiveTurnId(null);
          bag.setWorkStartedAt(null);
          // ⛔ 不 markThreadStopped：resume 报 "no rollout found" 最常见的两种情形之一正是
          //   「会话刚建好、首回合正在跑、rollout 还没落盘」——此时"清"就是把自己正在跑的任务判死，
          //   紧接着的下一条消息会走 turn/start 打断它（同切会话那条路径）。
          requestAnimationFrame(() => requestAnimationFrame(() => jumpToBottom(bag.scrollRef.current, markSettled, bag.contentTailTarget)));
          requestAnimationFrame(() => bag.composerInputRef.current?.focus());
          return;
        }
        bag.scopedNotice(error.message, id);
      }
    } finally {
      if (seq === bag.switchSeqRef.current) {
        bag.setOpeningThread(null);
        // 兜底淡出遮罩：成功路径里 markSettled 已经被多次调用（cached 秒开 / resume 后），
        // 这里再调一次保证错误路径（resume 抛错/seq 已切走）也能让遮罩淡出；fade-out
        // timer 重置机制保证多次调用安全，最终只有最后一次稳定后才真正卸载。
        markSettled();
        // 焦点还给输入框：归档恢复/切会话后焦点常残留在已卸载的设置弹窗上，表现为"失焦无法输入"
        requestAnimationFrame(() => bag.composerInputRef.current?.focus());
      }
    }
  }
