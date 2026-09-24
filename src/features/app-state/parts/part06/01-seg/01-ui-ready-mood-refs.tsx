/**
 * usePart06a1 —— usePart06a 按序切分出的第 1 段（纯搬迁、零改写）。
 * 域：设置内容就绪/搜索防抖/流时间戳/基调 — 运行态与派发 · 委托记录 · 角色
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { advanceMood, composeMoodInstructions, emptyMood, moodBlock, moodSignature, moodTone, normalizeMood, userSignalOf } from "../../../../../lib/agent-mood.mjs";
import { EnvCheckDialog, ENV_CHECK_SPEC, ENV_CHECK_OPTOUT_KEY, type EnvCheckState } from "../../../../../components/EnvCheckDialog";
import { classifyUnit, buildSegments, buildOrderedToolRuns, foldItemStatus, computeFoldSummary, topToolGroup, isTurnRunning, normalizeLoadedThread, type FoldUnit } from "../../../../../lib/turn-fold";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";

export function usePart06a1(bag: Bag) {
  // 首次启动「环境体检」（09-17）：等首屏数据与模型引导判断都落定后再检测，避免两个弹窗抢屏。
  // ⛔ 只判一次（envCheckDoneRef）——否则下面 setDevRuntimes 刷新会把它反复触发。
  // ⛔ 模型引导正在弹时不检测：没配模型是"发不出消息"级硬阻断，优先处理它；等它关掉本 effect 会重建。
  // ⛔ 读了「不再提示」直接跳过：那是用户在体检里主动勾的，不该每次启动再问一遍。
  useEffect(() => {
    if (bag.envCheckDoneRef.current) return;
    if (bag.threadsLoading || bag.showLogin || bag.showModelGuide) return;
    // 诊断埋点（保留）：用户报「缺工具但没弹体检」时，直接看 window.__envCheckDbg 就知道卡在哪一步
    // （effect 有没有跑 / timer 有没有触发 / optout 有没有被读到 / listRuntimes 看到的工具状态）。
    (window as any).__envCheckDbg = { effectRan: true, threadsLoading: bag.threadsLoading, showLogin: bag.showLogin, showModelGuide: bag.showModelGuide };
    const timer = window.setTimeout(async () => {
      // ⛔ done 标记必须在这里（**真正检查过**）才置位，绝不能放在 effect 开头。
      //    effect 依赖里有 workspace / customModel，启动过程它们必然变化 → effect 重建 →
      //    cleanup 把 timer 清掉；若 done 已被提前置 true，新 effect 会直接 return，
      //    那个 timer 就永远不会执行 —— 体检永远不弹。
      //    （09-17 真启动实测踩到：把 rg.exe 移走模拟缺工具，弹窗依然不出现。）
      if (bag.envCheckDoneRef.current) return;
      bag.envCheckDoneRef.current = true;
      const dbg: Record<string, unknown> = { ...(window as any).__envCheckDbg, timerFired: true };
      try {
        dbg.optout = localStorage.getItem(ENV_CHECK_OPTOUT_KEY);
        if (dbg.optout === "1") return;
        const list = await window.codex.listRuntimes();
        bag.setDevRuntimes(list);
        dbg.listRuntimes = list.filter((entry) => ["git", "rg", "pwsh", "python", "jq", "sevenzip"].includes(entry.id))
          .map((entry) => `${entry.id}:${entry.installed ? "ok" : "missing"}`);
      const missingCore = bag.envSpecs.filter((spec) => spec.core).filter((spec) => {
        if (spec.id === "model") return !bag.customModel;
        return !list.find((entry) => entry.id === spec.id)?.installed;
      });
      dbg.missingCore = missingCore.map((spec) => spec.id);
      // ⛔⛔ 09-19（用户：「登录界面和模型供应商配置联动性差，新手总是不会」）：
      //   没配模型时**不要弹体检** —— 两个弹窗几乎同时抢屏（模型引导 1.2s、体检 1.4s），
      //   新手不知道该先干哪个；而且"能不能发消息"是前提，"工具装没装"是第二层。
      //   模型配好之后（customModel 变化会重建本 effect）体检自然会来提工具的事。
      if (!bag.customModel) { dbg.deferredByModel = true; return; }
      if (missingCore.length > 0) bag.setEnvCheckOpen(true);
      } catch (error: any) {
        dbg.error = String(error?.message ?? error);
      } finally {
        (window as any).__envCheckDbg = dbg;
      }
    }, 1400);
    return () => window.clearTimeout(timer);
    // customModel / workspace 变化会重建本 effect（清掉旧计时器）→ 1.4s 后读到的一定是最新值
  }, [bag.threadsLoading, bag.showLogin, bag.showModelGuide, bag.customModel, bag.workspace, bag.envSpecs]);



  // 设置弹窗「骨架先行」：点击入口先画弹窗框架与 loading，重内容与引擎 RPC 延后一帧。
  // 软件渲染（无 GPU 加速）机器上弹窗内容大，同步挂载会造成「点了没反应」的冻结感。
  const [settingsContentReady, setSettingsContentReady] = useState(false);
bag.settingsContentReady = settingsContentReady as typeof bag.settingsContentReady; bag.setSettingsContentReady = setSettingsContentReady as typeof bag.setSettingsContentReady;


  useEffect(() => {
    if (!bag.settingsOpen) { bag.setSettingsContentReady(false); return; }
    let raf2 = 0;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      bag.setSettingsContentReady(true);
      void bag.refreshSettingsResources();
    };
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(settle);
    });
    // 兜底：软件渲染 / 窗口后台时 rAF 可能被抑制甚至不触发，只靠 rAF 会让设置页
    // 永远停在「正在载入…」（e2e 隔离实例实测复现）。120ms 定时器与 rAF 竞争，
    // 谁先到都能让内容挂载——只是骨架先行的时长稍微放宽，不影响正常机器的手感。
    const timer = window.setTimeout(settle, 120);
    return () => { cancelAnimationFrame(raf1); if (raf2) cancelAnimationFrame(raf2); window.clearTimeout(timer); };
  }, [bag.settingsOpen, bag.workspace]);


  // MCP 状态（toolsAndAuthOnly 会逐个拉起 MCP 服务枚举工具，CPU 开销大）只在真正进入
  // MCP 管理页时拉取，打开技能/插件等其他分区不再连带触发冷启动争抢。
  const mcpDetailLoadedRef = useRef(false);
bag.mcpDetailLoadedRef = mcpDetailLoadedRef as typeof bag.mcpDetailLoadedRef;


  useEffect(() => {
    if (bag.settingsOpen && bag.settingsPage === "mcp" && bag.settingsContentReady && !bag.mcpDetailLoadedRef.current) {
      bag.mcpDetailLoadedRef.current = true;
      void bag.refreshSettingsResources({ mcpDetail: true });
    }
  }, [bag.settingsOpen, bag.settingsPage, bag.settingsContentReady]);


  // 市场列表按需加载：只有对应市场页真正可见时才请求（应用启动不再全量拉取）；
  // 搜索输入 350ms 防抖，避免每个按键都打一次远端接口
  const [skillHubSearchDebounced, setSkillHubSearchDebounced] = useState("");
bag.skillHubSearchDebounced = skillHubSearchDebounced as typeof bag.skillHubSearchDebounced; bag.setSkillHubSearchDebounced = setSkillHubSearchDebounced as typeof bag.setSkillHubSearchDebounced;


  useEffect(() => { const t = setTimeout(() => bag.setSkillHubSearchDebounced(bag.skillHubSearch), 350); return () => clearTimeout(t); }, [bag.skillHubSearch]);


  const [pluginMarketSearchDebounced, setPluginMarketSearchDebounced] = useState("");
bag.pluginMarketSearchDebounced = pluginMarketSearchDebounced as typeof bag.pluginMarketSearchDebounced; bag.setPluginMarketSearchDebounced = setPluginMarketSearchDebounced as typeof bag.setPluginMarketSearchDebounced;


  useEffect(() => { const t = setTimeout(() => bag.setPluginMarketSearchDebounced(bag.pluginMarketSearch), 350); return () => clearTimeout(t); }, [bag.pluginMarketSearch]);


  useEffect(() => {
    if (!bag.settingsOpen || bag.settingsPage !== "skills" || bag.skillsManageOnly) return;
    void bag.refreshMarketSkills(bag.skillHubCategory, bag.skillHubSearchDebounced, bag.marketPage);
  }, [bag.settingsOpen, bag.settingsPage, bag.skillHubCategory, bag.skillHubSearchDebounced, bag.skillsManageOnly, bag.marketPage]);


  useEffect(() => {
    if (!bag.settingsOpen || bag.settingsPage !== "plugins") return;
    void bag.refreshMarketPlugins(bag.pluginMarketCategory, bag.pluginMarketSearchDebounced, bag.pluginMarketPage);
  }, [bag.settingsOpen, bag.settingsPage, bag.pluginMarketCategory, bag.pluginMarketSearchDebounced, bag.pluginMarketPage]);



  useEffect(() => {
    if (!bag.thread) return;
    void window.codex.request("thread/memoryMode/set", { threadId: bag.thread.id, mode: bag.memoryEnabled ? "enabled" : "disabled" }).catch(() => undefined);
  }, [bag.thread?.id]);



  useEffect(() => {
    if (bag.rightTab === "tree" && bag.workspace) void bag.loadTree(bag.workspace);
  }, [bag.rightTab, bag.workspace]);



  useEffect(() => {
    if (bag.thread) void bag.refreshQueue(bag.thread.id);
    else bag.setQueue([]);
  }, [bag.thread?.id]);



  // 流式断流心跳监控：回合进行中但 >90s 没有任何流式事件 → 多半是 turn/completed 丢了
  // （引擎重启/流断掉），向引擎 resume 校对；只有服务端明确已结束而本地还在跑时才落地，
  // 解开「任务早就写完却永远正在运行 + 过程卡片刷屏」的死局。正常流式不受影响。
  const lastStreamTsRef = useRef(Date.now());
bag.lastStreamTsRef = lastStreamTsRef as typeof bag.lastStreamTsRef;


  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = bag.threadRef.current;
      const lastTurn = current?.turns[current.turns.length - 1];
      if (!current || !lastTurn || !isTurnRunning(lastTurn)) return;
      if (Date.now() - bag.lastStreamTsRef.current < 90_000) return;
      bag.lastStreamTsRef.current = Date.now(); // 防抖：resume 失败也不要每 30s 连环打
      // 心跳校对期间给用户可见反馈：否则「引擎其实在跑但没出字」看起来就是莫名其妙不回复
      const staleTurnId = lastTurn.id;
      const staleThreadName = current.name || "当前会话";
      bag.setSystemEvents((currentEvents) => {
        if (currentEvents.some((event) => event.hookKey === `stream-stale-${staleTurnId}`)) return currentEvents;
        return [...currentEvents, { id: crypto.randomUUID(), title: "回复等待中", text: "超过 90 秒没有收到新内容，正在与引擎校对任务状态……（若上游卡住，可点输入框旁的停止按钮后重发）", tone: "warning", hookKey: `stream-stale-${staleTurnId}` }] as any;
      });
      // 提醒不常驻：无论校对是否确认（上游真卡住时 resume 对不上会一直挂着），25s 后自动撤掉，
      // 避免「回复等待中」占位卡在时间线里不好看；引擎恢复/校对确认时下方也会主动清除。
      window.setTimeout(() => {
        bag.setSystemEvents((currentEvents) => currentEvents.filter((event) => event.hookKey !== `stream-stale-${staleTurnId}`));
      }, 25_000);
      void window.codex.request("thread/resume", { threadId: current.id, excludeTurns: false }).then((result) => {
        if (!result?.thread) return;
        const serverLast = result.thread.turns[result.thread.turns.length - 1];
        const localLast = bag.threadRef.current?.turns[bag.threadRef.current.turns.length - 1];
        if (!serverLast || !localLast || serverLast.id !== localLast.id) return;
        if (isTurnRunning(localLast) && !isTurnRunning(serverLast)) {
          const merged = mergeTurn(bag.threadRef.current, serverLast);
          if (merged && merged !== bag.threadRef.current) {
            bag.threadRef.current = merged;
            bag.threadCacheRef.current.set(merged.id, merged);
            bag.setThread(merged);
            // 校对确认已结束：撤掉等待提示（success 常驻可手动关，不自动消失误导）
            bag.setSystemEvents((currentEvents) => currentEvents.filter((event) => event.hookKey !== `stream-stale-${staleTurnId}`));
            bag.setSystemEvents((currentEvents) => [...currentEvents, { id: crypto.randomUUID(), title: "状态已同步", text: `「${staleThreadName}」的任务实际已在上游完成，界面已恢复。`, tone: "info", hookKey: `stream-settled-${staleTurnId}` }] as any);
          }
        }
      }).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);



  // （已删除重复的 smooth 跟随 effect：sticky layout effect 已在 [thread] 变化时
  // 用 behavior:auto 同步跳底，smooth 版本会在长会话切换时产生数秒的滚动动画。）

  /** 全局基线 developer instructions（config.toml 顶层那段：语言 / 内置工具 / 自动化说明）。
   *  会话作用域块必须**拼在它之后**一起下发——只发作用域块会把基线顶掉，模型就不知道
   *  nuphus-call / playwright-cli / generate_image 这些内置工具怎么用了。读一次缓存住。 */
  const baseInstructionsRef = useRef("");
bag.baseInstructionsRef = baseInstructionsRef as typeof bag.baseInstructionsRef;


  /** 每个会话最近一次下发的作用域签名：同签名不重发，避免反复打开会话刷 RPC。 */
  const scopeSigRef = useRef<Record<string, string>>({});
bag.scopeSigRef = scopeSigRef as typeof bag.scopeSigRef;


  // ── 语气自适应（09-19 用户要求「agent 有状态、语气跟着变」）─────────────────────────────
  /** 开关的 ref 镜像：onHarnessEvent 的监听在挂载时注册一次，闭包捕获的是**当时**的 state，
   *  直接读 `adaptiveTone` 会永远读到初值（历史坑：effect 里读 state 恒为旧值）。 */
  const adaptiveToneRef = useRef(true);
bag.adaptiveToneRef = adaptiveToneRef as typeof bag.adaptiveToneRef;


  useEffect(() => { bag.adaptiveToneRef.current = bag.adaptiveTone; }, [bag.adaptiveTone]);


  /** 状态键族：`agent-mood-<threadId>`（与 thread-runtime 同风格，但**独立存放**）。
   *  ⛔ 不塞进 thread-runtime：那是「用户配置」的单一存放处，规矩是「只有明确的用户动作才落盘」；
   *     状态是回合派生的运行时量、每回合都在变，混进去会破坏那条规矩并放大写入量。 */
  const moodKeyOf = (threadId: string) => "agent-mood-" + threadId;
bag.moodKeyOf = moodKeyOf as typeof bag.moodKeyOf;


  function readMood(threadId: string) {
    if (!threadId) return emptyMood();
    try { return normalizeMood(JSON.parse(localStorage.getItem(bag.moodKeyOf(threadId)) ?? "null")); } catch { return emptyMood(); }
  }
bag.readMood = readMood as typeof bag.readMood;


  function writeMood(threadId: string, state: unknown) {
    if (!threadId) return;
    try { localStorage.setItem(bag.moodKeyOf(threadId), JSON.stringify(normalizeMood(state))); } catch { /* 配额/隐私模式：软信息，落盘失败不致命 */ }
  }
bag.writeMood = writeMood as typeof bag.writeMood;


  /** 吃一个回合级信号：更新该会话自己的状态，并（必要时）把新语气下发到**该会话**。
   *  后台会话也更新（那是它自己的历史事实）；下发只在它是当前会话时立即做 ——
   *  等它被打开时随作用域一起下发，避免给没在看的会话发无谓 RPC。
   *  去重交给 pushSessionScope（签名含语气档），这里不预标记，否则下发失败会丢一次。 */
  /** 会话被删除时的级联清理：状态与下发签名一起清 —— 留着会让重建的同 id 会话继承旧状态，
   *  也会让 scopeSigRef 里的旧签名把首次下发判成「同签名」而直接跳过。 */
  function forgetThreadMood(threadId: string) {
    if (!threadId) return;
    try { localStorage.removeItem(bag.moodKeyOf(threadId)); } catch { /* ignore */ }
    delete bag.scopeSigRef.current[threadId];
  }
bag.forgetThreadMood = forgetThreadMood as typeof bag.forgetThreadMood;


  function bumpMood(threadId: string, signal: string) {
    if (!threadId || !signal || !bag.adaptiveToneRef.current) return;
    const next = advanceMood(bag.readMood(threadId), signal);
    bag.writeMood(threadId, next);
    if (threadId === bag.threadRef.current?.id) void bag.pushSessionScope(threadId);
  }
bag.bumpMood = bumpMood as typeof bag.bumpMood;
  return { settingsContentReady, setSettingsContentReady, mcpDetailLoadedRef, skillHubSearchDebounced, setSkillHubSearchDebounced, pluginMarketSearchDebounced, setPluginMarketSearchDebounced, lastStreamTsRef, baseInstructionsRef, scopeSigRef, adaptiveToneRef, moodKeyOf, readMood, writeMood, forgetThreadMood, bumpMood };
}
