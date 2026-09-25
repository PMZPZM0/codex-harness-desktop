/**
 * usePart03d（09-22：part03 按序切分出来的第 4 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { ALIGN_RESULT, CONTINUITY_TEXT, HARNESS_PROVIDER_ID, shouldAlignProvider } from "../../../../lib/provider-continuity.mjs";
import { groupThreadsBySource } from "../../../../lib/thread-source.mjs";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../app-view/helpers";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../app-view/types";
import type { Bag } from "../bag-types";

export function usePart03d(bag: Bag) {
  // 该模型/网关**已知不支持**的档位由 EffortPicker 每次打开时自己读
  // （src/lib/effort-support.ts）—— 这里只把模型 id 给它。
  const currentModelId = bag.selectedModel?.model ?? modelName(bag.modelId);
bag.currentModelId = currentModelId as typeof bag.currentModelId;

  const usingCustomModel = Boolean(bag.customModel && bag.modelId);
bag.usingCustomModel = usingCustomModel as typeof bag.usingCustomModel;

  // 官方订阅：thread/start 什么都不传（无 modelProvider、无内联 config）——
  // 引擎走内置 openai 通道 + auth.json ChatGPT 登录凭据，与实测通过的协议复现完全一致；
  // 任何内联 provider 定义（哪怕 requires_openai_auth=true）都会触发 CODEX_HARNESS_API_KEY 校验导致报错（实证）。
  const providerConfig = useMemo(() => bag.usingCustomModel && bag.customModel && bag.customModel.provider !== "openai-official" ? {
    // ⛔ 统一内置 provider id（09-14 用户定稿）：新建会话一律绑 HARNESS_PROVIDER_ID ——
    // 它永远指向「当前生效供应商」（config.toml 恒写该段）→ 切供应商时**无需任何会话迁移**。
    // 用户配置的真实 id 只用于显示与旧会话别名段（见 electron/main.ts 的 harness 段）。
    modelProvider: HARNESS_PROVIDER_ID,
    config: {
      model_provider: HARNESS_PROVIDER_ID,
      model_providers: {
        [HARNESS_PROVIDER_ID]: {
          name: bag.customModel.name,
          base_url: bag.customModel.baseUrl,
          env_key: "CODEX_HARNESS_API_KEY",
          wire_api: "responses" as const,
          requires_openai_auth: false,
        },
      },
    },
  } : {}, [bag.usingCustomModel, bag.customModel]);
bag.providerConfig = providerConfig as typeof bag.providerConfig;

  const listThreads = useMemo(() => bag.projectFilter ? bag.threads.filter((entry) => entry.cwd === bag.projectFilter) : bag.threads, [bag.threads, bag.projectFilter]);
bag.listThreads = listThreads as typeof bag.listThreads;

  // 侧边栏视图模式：分组（按时间） vs 项目（按 cwd）；与 WorkBuddy 项目列表对齐
  const [viewTab, setViewTab] = useState<"groups" | "projects" | "source">(() => {
    const saved = localStorage.getItem("sidebar-view-tab-v1");
    return saved === "projects" || saved === "source" ? saved : "groups";
  });
bag.viewTab = viewTab as typeof bag.viewTab; bag.setViewTab = setViewTab as typeof bag.setViewTab;

  useEffect(() => { try { localStorage.setItem("sidebar-view-tab-v1", bag.viewTab); } catch { /* ignore */ } }, [bag.viewTab]);

  // 项目展开状态：每个 cwd 独立控制；Set 表示已展开
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("sidebar-projects-expanded-v1") || "[]") as string[]); } catch { return new Set<string>(); }
  });
bag.expandedProjects = expandedProjects as typeof bag.expandedProjects; bag.setExpandedProjects = setExpandedProjects as typeof bag.setExpandedProjects;

  const toggleProjectExpanded = useCallback((cwd: string) => {
    bag.setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) next.delete(cwd); else next.add(cwd);
      try { localStorage.setItem("sidebar-projects-expanded-v1", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);
bag.toggleProjectExpanded = toggleProjectExpanded as typeof bag.toggleProjectExpanded;

  /** ★ 会话「项目地址」的本地覆盖（09-19 用户实测：「在已创建会话上改了地址，只是对话框上面显示改了，
   *  左侧栏没有变化；新增的项目地址也不出现 —— 这个切换项目地址功能这样看就是假的」）。
   *  根因：引擎侧 `thread/settings/update {cwd}` 改的是**运行时**工作目录，而 `thread/list` 回包的 cwd
   *  仍是创建时写进 rollout 的那个 ⇒ 只发 settings/update 永远改不动侧栏（侧栏项目分组是按 entry.cwd 派的）。
   *  所以把用户**显式改过**的地址记在这里（threadId → cwd），并在列表刷新 / 打开会话时覆盖引擎值：
   *  侧栏分组、「只看该项目」、重启之后三处都一致。 */
  const [cwdOverrides, setCwdOverrides] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("thread-cwd-override-v1") || "{}") as Record<string, string>; } catch { return {}; }
  });
bag.cwdOverrides = cwdOverrides as typeof bag.cwdOverrides; bag.setCwdOverrides = setCwdOverrides as typeof bag.setCwdOverrides;

  const cwdOverridesRef = useRef<Record<string, string>>(bag.cwdOverrides);
bag.cwdOverridesRef = cwdOverridesRef as typeof bag.cwdOverridesRef;

  const rememberThreadCwd = useCallback((threadId: string | null | undefined, cwd: string) => {
    if (!threadId || !cwd) return;
    const next = { ...bag.cwdOverridesRef.current, [threadId]: cwd };
    bag.cwdOverridesRef.current = next;
    try { localStorage.setItem("thread-cwd-override-v1", JSON.stringify(next)); } catch { /* ignore */ }
    bag.setCwdOverrides(next);
  }, []);
bag.rememberThreadCwd = rememberThreadCwd as typeof bag.rememberThreadCwd;

  /** 会话当前**生效**的项目地址（用户显式改过就用本地的，否则用引擎给的） */
  const effectiveCwd = useCallback((threadId: string | null | undefined, engineCwd: string | null | undefined) => {
    if (threadId) {
      const override = bag.cwdOverridesRef.current[threadId];
      if (override) return override;
    }
    return engineCwd ?? "";
  }, []);
bag.effectiveCwd = effectiveCwd as typeof bag.effectiveCwd;

  /** 把本地覆盖贴到引擎回包上（列表与单会话都要走一遍，否则一次刷新就回退） */
  const withCwdOverride = useCallback(<T extends { id: string; cwd: string }>(entry: T): T => {
    const cwd = bag.effectiveCwd(entry.id, entry.cwd);
    return cwd && cwd !== entry.cwd ? { ...entry, cwd } : entry;
  }, [bag.effectiveCwd]);
bag.withCwdOverride = withCwdOverride as typeof bag.withCwdOverride;

  /** 会话**显示名**的本地覆盖（threadId → 名字）。
   *  ⛔ 为什么名字必须本地权威（09-20 实测，用户报「导入会话改名不生效，一直显示导入…」）：
   *  引擎会在**该会话第一条用户消息**到达时用它自动生成 `name`，**把此前 `thread/name/set`
   *  设过的名字直接覆盖掉**。真机复现（隔离 CODEX_HOME + 真实 app-server）：
   *    `thread/name/set("我自己改的名字")` → `turn/start("回复两个字：收到")`
   *    → 之后读回 `name = "回复两个字：收到"`。
   *  于是「导入 → 改名 → 发首条消息」必然失效：那条首条消息就是整段导入记录（`[导入的会话记录]…`），
   *  名字被顶成消息内容，用户看到的就是「一直显示导入…」。
   *  另外这条链上还有第二个坑：**无回合的会话不在 `thread/list` 里**（实测 has_user_event=0 的线程
   *  一条都不返回），所以刚导入时侧栏/列表根本读不到引擎那份名字 —— 两侧夹击，唯一可靠的做法
   *  就是**用户显式改过的名字由本地持有**。与 cwdOverrides 同构，覆盖在列表刷新 / 打开会话 /
   *  resume 三处贴回（见 withNameOverride 的调用点）。 */
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("thread-name-override-v1") || "{}") as Record<string, string>; } catch { return {}; }
  });
bag.nameOverrides = nameOverrides as typeof bag.nameOverrides; bag.setNameOverrides = setNameOverrides as typeof bag.setNameOverrides;

  const nameOverridesRef = useRef<Record<string, string>>(bag.nameOverrides);
bag.nameOverridesRef = nameOverridesRef as typeof bag.nameOverridesRef;

  const rememberThreadName = useCallback((threadId: string | null | undefined, name: string) => {
    if (!threadId || !name) return;
    const next = { ...bag.nameOverridesRef.current, [threadId]: name };
    bag.nameOverridesRef.current = next;
    try { localStorage.setItem("thread-name-override-v1", JSON.stringify(next)); } catch { /* ignore */ }
    bag.setNameOverrides(next);
  }, []);
bag.rememberThreadName = rememberThreadName as typeof bag.rememberThreadName;

  /** 会话当前**生效**的显示名（用户显式改过就用本地的，否则用引擎给的） */
  const effectiveThreadName = useCallback((threadId: string | null | undefined, engineName: string | null | undefined) => {
    if (threadId) {
      const override = bag.nameOverridesRef.current[threadId];
      if (override) return override;
    }
    return engineName ?? "";
  }, []);
bag.effectiveThreadName = effectiveThreadName as typeof bag.effectiveThreadName;

  /** 把名字覆盖贴到引擎回包上（列表 / 单会话 / resume 都要走一遍，否则一次刷新就回退） */
  const withNameOverride = useCallback(<T extends { id: string; name?: string | null }>(entry: T): T => {
    const name = bag.effectiveThreadName(entry.id, entry.name);
    return name && name !== entry.name ? { ...entry, name } : entry;
  }, [bag.effectiveThreadName]);
bag.withNameOverride = withNameOverride as typeof bag.withNameOverride;

  // 项目右键菜单
  const [projectMenu, setProjectMenu] = useState<string | null>(null);
bag.projectMenu = projectMenu as typeof bag.projectMenu; bag.setProjectMenu = setProjectMenu as typeof bag.setProjectMenu;

  // 会话置顶：纯前端偏好（引擎无 pin API），用 localStorage 存 id 列表。
  // 置顶的会话在侧栏固定排在最前（置顶组内仍按时间倒序），unpin 后回到原时间序。
  const [pinnedThreads, setPinnedThreads] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("pinned-threads") ?? "[]") as string[]; } catch { return []; }
  });
bag.pinnedThreads = pinnedThreads as typeof bag.pinnedThreads; bag.setPinnedThreads = setPinnedThreads as typeof bag.setPinnedThreads;

  useEffect(() => {
    try { localStorage.setItem("pinned-threads", JSON.stringify(bag.pinnedThreads)); } catch { /* ignore */ }
  }, [bag.pinnedThreads]);

  function togglePinThread(id: string) {
    bag.setPinnedThreads((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  }
bag.togglePinThread = togglePinThread as typeof bag.togglePinThread;

  const projectGroups = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const entry of bag.listThreads) map.set(entry.cwd, [...(map.get(entry.cwd) ?? []), entry]);
    return [...map.entries()].sort((a, b) => Math.max(...b[1].map((entry) => entry.updatedAt)) - Math.max(...a[1].map((entry) => entry.updatedAt)));
  }, [bag.listThreads]);
bag.projectGroups = projectGroups as typeof bag.projectGroups;

  const allProjectsCollapsed = bag.projectGroups.length > 0 && bag.projectGroups.every(([cwd]) => !bag.expandedProjects.has(cwd));
bag.allProjectsCollapsed = allProjectsCollapsed as typeof bag.allProjectsCollapsed;

  const toggleAllProjects = useCallback(() => {
    bag.setExpandedProjects((prev) => {
      const next = new Set(prev);
      const expand = bag.projectGroups.every(([cwd]) => !next.has(cwd));
      for (const [cwd] of bag.projectGroups) {
        if (expand) next.add(cwd);
        else next.delete(cwd);
      }
      try { localStorage.setItem("sidebar-projects-expanded-v1", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, [bag.projectGroups]);
bag.toggleAllProjects = toggleAllProjects as typeof bag.toggleAllProjects;

  /** 启动后**首次**拿到项目分组时，自动展开「当前会话所在的项目」（09-19 用户实测：
   *  「启动应用，左侧栏没有自动展开项目…要手动展开」）。只在第一次就绪时做一次，
   *  之后完全交给用户的展开/折叠偏好（persisted 在 sidebar-projects-expanded-v1）。 */
  const projectAutoExpandRef = useRef(false);
bag.projectAutoExpandRef = projectAutoExpandRef as typeof bag.projectAutoExpandRef;

  useEffect(() => {
    if (bag.projectAutoExpandRef.current || !bag.projectGroups.length) return;
    bag.projectAutoExpandRef.current = true;   // 想在真正执行处置位：分组就绪才算执行
    const activeCwd = bag.effectiveCwd(bag.threadRef.current?.id, bag.threadRef.current?.cwd) || bag.workspace || bag.projectGroups[0][0];
    const hit = bag.projectGroups.some(([cwd]) => cwd === activeCwd) ? activeCwd : bag.projectGroups[0][0];
    bag.setExpandedProjects((prev) => {
      if (prev.has(hit)) return prev;
      const next = new Set(prev);
      next.add(hit);
      try { localStorage.setItem("sidebar-projects-expanded-v1", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, [bag.projectGroups, bag.effectiveCwd, bag.workspace]);

  const groupedThreads = useMemo(() => {
    const groups = groupThreadsByTime(bag.listThreads);
    const pinned = bag.listThreads.filter((entry) => bag.pinnedThreads.includes(entry.id));
    if (!pinned.length) return groups;
    // 置顶组固定排最前：仅保留未归档里的置顶项，组内按时间倒序
    return [{ key: "pinned", label: "置顶", items: pinned.sort((a, b) => b.updatedAt - a.updatedAt) }, ...groups.filter((g) => g.key !== "pinned")];
  }, [bag.listThreads, bag.pinnedThreads]);
bag.groupedThreads = groupedThreads as typeof bag.groupedThreads;

  /* 侧栏「分类」视图（09-25 用户要求）：按**会话来源**归类 ——
     主代理会话 / 专家团主理人 / 团队成员子任务 / 专家调度 / 子智能体调度 / 专家团调度。
     口径收在纯模块 src/lib/thread-source.mjs（可被预检直接跑断言）；数据全为既有真相源。 */
  const sourcedThreads = useMemo(() => groupThreadsBySource(bag.listThreads, {
    delegateRecords: bag.delegateRecords,
    teamThreadIndex: bag.teamThreadsIndex,
    teamMemberThreadIds: bag.teamMemberThreadIds,
    pinnedThreadIds: bag.pinnedThreads,
  }), [bag.listThreads, bag.delegateRecords, bag.teamThreadsIndex, bag.teamMemberThreadIds, bag.pinnedThreads]);
bag.sourcedThreads = sourcedThreads as typeof bag.sourcedThreads;

  const allSourceGroupsCollapsed = bag.sourcedThreads.length > 0 && bag.sourcedThreads.every((group) => bag.collapsedSections.has(group.key));
bag.allSourceGroupsCollapsed = allSourceGroupsCollapsed as typeof bag.allSourceGroupsCollapsed;

  const allGroupsCollapsed = bag.groupedThreads.length > 0 && bag.groupedThreads.every((group) => bag.collapsedSections.has(group.key));
bag.allGroupsCollapsed = allGroupsCollapsed as typeof bag.allGroupsCollapsed;

  // ── 专家团会话聚簇（09-14 用户反馈）：一个专家团的主会话 + N 个成员会话在侧栏占 N+1 行，
  // 把成员会话合并进主会话行下、默认折叠，点「成员会话」展开。
  // threadId → teamId 的权威映射在主进程（team-threads.json），启动时拉一次 + team-run 广播时刷新。
  const [teamThreadsIndex, setTeamThreadsIndex] = useState<Record<string, string>>({});
bag.teamThreadsIndex = teamThreadsIndex as typeof bag.teamThreadsIndex; bag.setTeamThreadsIndex = setTeamThreadsIndex as typeof bag.setTeamThreadsIndex;

  /** ★ 主进程 members 映射的值 = **成员会话线程** id。threads 表里主会话也在，
   *  区分主/成员只能靠这份 members（用户 09-14 纠正「交易分析团是主会话，你别搞错了」——
   *  此前靠标题猜「不带 · 的是主会话」，标题被截断/改名/preview 兜底时会认错）。 */
  const [teamMemberThreadIds, setTeamMemberThreadIds] = useState<Set<string>>(new Set());
bag.teamMemberThreadIds = teamMemberThreadIds as typeof bag.teamMemberThreadIds; bag.setTeamMemberThreadIds = setTeamMemberThreadIds as typeof bag.setTeamMemberThreadIds;

  useEffect(() => {
    let alive = true;
    void window.codex.teamThreadsMap?.().then((doc) => {
      if (!alive) return;
      if (doc?.threads) bag.setTeamThreadsIndex(doc.threads);
      if (doc?.members) bag.setTeamMemberThreadIds(new Set(Object.values(doc.members)));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return { currentModelId, usingCustomModel, providerConfig, listThreads, viewTab, setViewTab, expandedProjects, setExpandedProjects, toggleProjectExpanded, cwdOverrides, setCwdOverrides, cwdOverridesRef, rememberThreadCwd, effectiveCwd, withCwdOverride, nameOverrides, setNameOverrides, nameOverridesRef, rememberThreadName, effectiveThreadName, withNameOverride, projectMenu, setProjectMenu, pinnedThreads, setPinnedThreads, togglePinThread, projectGroups, allProjectsCollapsed, toggleAllProjects, projectAutoExpandRef, groupedThreads, allGroupsCollapsed, sourcedThreads, allSourceGroupsCollapsed, teamThreadsIndex, setTeamThreadsIndex, teamMemberThreadIds, setTeamMemberThreadIds };
}
