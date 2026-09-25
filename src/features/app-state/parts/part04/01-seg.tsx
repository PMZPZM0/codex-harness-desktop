/**
 * usePart04a（09-22：part04 按序切分出来的第 1 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { imageToken, splitPromptSegments, promptImagePaths, stripImageTokens, isImagePart, imagePartSrc, normalizeImagePartForSend } from "../../../../lib/prompt-images";
import { currentStreak, dayKey, formatTokens, lastDays, readUsageStats, recordTurnUsage, resetUsageStats, totalTokens } from "../../../../lib/usage-stats";
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "../../../../lib/user-refs";
import { isImagePath } from "../../../../lib/is-image-path";
import { itemText } from "../../../../lib/item-text";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../app-view/helpers";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../app-view/types";
import type { Bag } from "../bag-types";

export function usePart04a(bag: Bag) {
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data: any = event.data;
      // 调度登记变化（发起 / 结束 / 归档）→ 刷新「被调度的临时会话」：驱动侧栏标记与注册侧过滤
      if (data?.channel === "harness:event" && data?.event?.type === "delegates-changed") {
        void bag.refreshDelegateRecords();
        // 调度会**新建会话**：只刷登记表不够，侧栏列表也必须跟着拉一次，
        // 否则新会话根本不在 threads 里 → 用户看不到刚被调度的临时会话（09-15 验收实测踩到）。
        void bag.refreshThreads();
      }
      if (data?.channel === "harness:event" && data?.event?.type === "team-run") bag.setTeamThreadsIndex((prev) => {
        const run = data.event.run;
        if (!run?.leadThreadId || !run?.teamId || prev[run.leadThreadId] === run.teamId) return prev;
        return { ...prev, [run.leadThreadId]: run.teamId };
      });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  /** 展开的专家团簇（teamId 集合）。默认全部折叠（用户定稿：默认合并）。 */
  const [expandedTeamClusters, setExpandedTeamClusters] = useState<Set<string>>(new Set());
bag.expandedTeamClusters = expandedTeamClusters as typeof bag.expandedTeamClusters; bag.setExpandedTeamClusters = setExpandedTeamClusters as typeof bag.setExpandedTeamClusters;

  /** 展开某个簇后，把当前打开的会话行滚入视野（用户反馈「我选择下面会话都没有反馈，
   *  都不知道选择了那个」——展开体限高滚动时选中行可能在视野外）。 */
  useEffect(() => {
    if (!bag.expandedTeamClusters.size) return;
    const raf = requestAnimationFrame(() => {
      document.querySelector(".team-cluster-body .thread-row.active")?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [bag.expandedTeamClusters, bag.thread?.id]);

  const toggleTeamCluster = useCallback((teamId: string) => {
    bag.setExpandedTeamClusters((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId); else next.add(teamId);
      return next;
    });
  }, []);
bag.toggleTeamCluster = toggleTeamCluster as typeof bag.toggleTeamCluster;

  /** 聚簇后的侧栏结构：成员会话行从原分组抽走，作为 cluster 子项渲染。
   *  主会话识别：threads 表里同 teamId 的会话中，标题**不带**成员会话特征（「 · 」分隔或
   *  [专家团 前缀）的那条；主会话不在列表（被删/归档）时用最新成员会话当代表行。 */
  const clusteredSidebar = useMemo(() => {
    const memberIds = new Set<string>();
    const clusters = new Map<string, { teamId: string; lead: Thread | null; members: Thread[] }>();
    for (const entry of bag.listThreads) {
      const teamId = bag.teamThreadsIndex[entry.id];
      if (!teamId) continue;
      let cluster = clusters.get(teamId);
      if (!cluster) { cluster = { teamId, lead: null, members: [] }; clusters.set(teamId, cluster); }
      // ★ 权威判定：members 映射里的 = 成员会话；同团队里不在其中的 = **主会话**（团队名那条）
      if (bag.teamMemberThreadIds.has(entry.id)) { cluster.members.push(entry); memberIds.add(entry.id); }
      else if (!cluster.lead) cluster.lead = entry;
    }
    // ★ 兜底：映射里没有、但标题带 `[专家团「X」成员 Y（Z）]` 的历史成员会话 ——
    //   按团队名匹配专家团配置，归入同一个簇（否则它们散在外面，与簇内同职能成员「看起来重复」）。
    for (const entry of bag.listThreads) {
      if (bag.teamThreadsIndex[entry.id]) continue;
      const raw = `${entry.name ?? ""}${entry.preview ?? ""}`;
      const parsed = parseTeamMemberTitle(raw);
      if (!parsed) continue;
      const team = bag.expertTeams.find((t) => t.displayName.zh === parsed.teamName);
      if (!team) continue;
      let cluster = clusters.get(team.teamId);
      if (!cluster) { cluster = { teamId: team.teamId, lead: null, members: [] }; clusters.set(team.teamId, cluster); }
      cluster.members.push(entry);
      memberIds.add(entry.id);
    }
    for (const cluster of clusters.values()) {
      cluster.members.sort((a, b) => b.updatedAt - a.updatedAt);
      if (!cluster.lead) {
        // 主会话兜底：成员会话名是「团队 · 职能」或以 [专家团 开头；主会话名 = 团队名
        const lead = cluster.members.find((entry) => {
          const name = cleanThreadDisplayTitle(entry.name, { preview: entry.preview });
          return !/\s·\s/.test(name) && !name.startsWith("[专家团");
        });
        if (lead) { cluster.lead = lead; cluster.members = cluster.members.filter((m) => m.id !== lead.id); }
      }
    }
    return { memberIds, clusters: [...clusters.values()] };
  }, [bag.listThreads, bag.teamThreadsIndex, bag.teamMemberThreadIds, bag.expertTeams]);
bag.clusteredSidebar = clusteredSidebar as typeof bag.clusteredSidebar;

  /* 「分类」视图（09-25）：全部折叠/展开。键带 `source:` 前缀 ⇒ 与项目视图的折叠状态互不干扰，
     共用同一个 collapsedSections 存储。 */
  const toggleAllSources = useCallback(() => {
    bag.setCollapsedSections((previous) => {
      const next = new Set(previous);
      const collapse = !bag.sourcedThreads.every((group) => next.has(group.key));
      for (const group of bag.sourcedThreads) {
        if (collapse) next.add(group.key);
        else next.delete(group.key);
      }
      try { localStorage.setItem("sidebar-sections-collapsed", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, [bag.sourcedThreads]);
bag.toggleAllSources = toggleAllSources as typeof bag.toggleAllSources;

  const sidebarAllCollapsed = bag.viewTab === "source" ? bag.allSourceGroupsCollapsed : bag.allProjectsCollapsed;
bag.sidebarAllCollapsed = sidebarAllCollapsed as typeof bag.sidebarAllCollapsed;

  const toggleAllSidebarSections = bag.viewTab === "source" ? bag.toggleAllSources : bag.toggleAllProjects;
bag.toggleAllSidebarSections = toggleAllSidebarSections as typeof bag.toggleAllSidebarSections;

  // 「清空当前视图」批量删除按钮已下架（2026-09-04 反馈：侧栏顶部太容易误触）。
  // purgeCurrentTab / currentTabIds 一并移除；批量删除能力保留在单条任务右键/菜单里。
/** 长会话首屏最多渲染的回合数（1 回合 = 一次用户输入 + 一次回复，即一个对话来回）：
 *  软件渲染下全量挂载几千个回合是「切会话慢」的主因。**用户 09-14 定稿：只渲染最近 5 回合，
 *  把懒加载做到极致**（切换会话只挂 5 个回合，越快越好）；更早的由「往上滚自动续载」按需展开，
 *  滚回最新（贴底）再收回来，所以切走切回都是这个成本。 */
const TURN_WINDOW = 5;
bag.TURN_WINDOW = TURN_WINDOW as typeof bag.TURN_WINDOW;

/** 每次续载的回合数（首屏取数 / 本地展开 / 网络分页共用）= 一页 5 个用户消息：
 *  与 TURN_WINDOW 一致，滚一屏补一批，单次请求的数据量最小（首屏与续载都最快）。
 *  消息刻度尺（MessageRuler）按 turns 派生刻度，所以续载后刻度会同步变多。 */
const TURNS_PAGE = 5;
bag.TURNS_PAGE = TURNS_PAGE as typeof bag.TURNS_PAGE;

/** 窗口状态（每个会话展开了多少回合）最多记忆多少个会话：超出的按「最久未访问」淘汰。
 *  这是内存保护——记忆本身是 09-14 为「切回长会话不缩水」加的，但不能无限涨。 */
const TURN_WINDOW_MEMORY_KEEP = 8;
bag.TURN_WINDOW_MEMORY_KEEP = TURN_WINDOW_MEMORY_KEEP as typeof bag.TURN_WINDOW_MEMORY_KEEP;

/** 把某会话的窗口状态「提到最新」，并淘汰最久未访问的条目（对象键序 = 访问序）。 */
function touchTurnWindow(id: string, map: Record<string, number>): Record<string, number> {
  const value = map[id];
  const rest: Record<string, number> = {};
  for (const key of Object.keys(map)) if (key !== id) rest[key] = map[key];
  const merged = value === undefined ? rest : { ...rest, [id]: value };
  const keys = Object.keys(merged);
  for (const key of keys.slice(0, Math.max(0, keys.length - bag.TURN_WINDOW_MEMORY_KEEP))) delete merged[key];
  return merged;
}
bag.touchTurnWindow = touchTurnWindow as typeof bag.touchTurnWindow;

/** 发送锚定的落点偏移：新消息顶部落在「对话区上边框往下」这么多像素处。
 *  用户口径（09-15 定稿，附截图框选位置）：「就顶边框往下一行半就行」。
 *  正文 14px × line-height 1.72 ≈ 24px/行 → 一行半 ≈ 36px。
 *  ⛔ 这不是「钉顶」（悬浮），是**固定落点**——消息落在文档流里、由尾部留白托住，
 *     agent 回复从它下方长出来，因此不可能遮挡内容（对比 sticky 方案的事故）。
 *  改这个值即可整体上下平移落点。 */
const ANCHOR_TOP_OFFSET_PX = 36;
bag.ANCHOR_TOP_OFFSET_PX = ANCHOR_TOP_OFFSET_PX as typeof bag.ANCHOR_TOP_OFFSET_PX;

/** ⛔ 历史教训（09-15 三次尝试，勿再走这条路）：曾想用 CSS `position: sticky` 让用户消息
 *  的位置由布局保证、彻底不碰滚动条。三次全部失败，根因是**结构性的**：
 *  ① sticky 只能在**包含块内部**位移，而用户消息的包含块是 `.turn-group`——刚发消息时那个组
 *     里只有这一条消息（~72px），下方没有空间可借 → 钉不住（实测连发第 2 条 gap=396）；
 *  ② 把留白放到 `.timeline` 末尾是**兄弟节点**、扩不了包含块；
 *  ③ 09-15 把它修「生效」之后（原先真因是 `.turn-group` 的 content-visibility 让 sticky 失效），
 *     气泡变成不透明白底浮层，**实测盖住同回合的助手消息**（bubble 132~204 vs text 170~959）→
 *     用户看到「消息中间几行被竖着切掉」。
 *  结论：**悬浮（sticky）与「不占空间且不遮挡后代」在文档流里无法兼得**。
 *  现行方案 = 上方 `ANCHOR_TOP_OFFSET_PX`（固定落点）+ 尾部留白托住：消息待在文档流里、
 *  agent 回复从它下方长出来，结构上不可能遮挡内容。 */
/** 尾部留白（`.timeline-bottom-spacer*`）**不参与**「跟到哪」的计算：
 *  所有"到底部"的目标一律取**内容底部**（`#timeline-content-end` 哨兵）而不是 `scrollHeight`。
 *  这是 09-12 那次「切走再切回：用户消息被切在视口顶 + 下方一大片空白」的根因——
 *  紧随留白一起滚到底 = 滚进留白里。留白只负责给锚点腾出可滚空间，绝不改变落点。
 *  取 0 = 内容底部正好贴住视口底沿（留白仍在下方、看不见）。 */
const CONTENT_TAIL_GAP_PX = 0;
bag.CONTENT_TAIL_GAP_PX = CONTENT_TAIL_GAP_PX as typeof bag.CONTENT_TAIL_GAP_PX;

/** 常用命令置顶顺序（用户高频：模型/思考/计划/目标/压缩优先） */
const COMMON_COMMAND_ORDER = ["plan", "goal", "model", "effort", "compact", "new", "resume", "review", "status", "help"];
bag.COMMON_COMMAND_ORDER = COMMON_COMMAND_ORDER as typeof bag.COMMON_COMMAND_ORDER;

const commandMatches = useMemo(() => {
    if (!bag.prompt.startsWith("/") || bag.prompt.includes(" ")) return [];
    const query = bag.prompt.slice(1).toLowerCase();
    const matches = slashCommands.filter(([name, description]) => name.includes(query) || description.includes(query));
    // 排序：① 前缀命中排前（打 /p 时 plan 置顶）；② 同级按常用度（COMMON_COMMAND_ORDER）；③ 其余按目录序
    const commonRank = (name: string) => { const i = bag.COMMON_COMMAND_ORDER.indexOf(name); return i === -1 ? bag.COMMON_COMMAND_ORDER.length : i; };
    return matches.sort((a, b) =>
      Number(b[0].startsWith(query)) - Number(a[0].startsWith(query))
      || commonRank(a[0]) - commonRank(b[0]));
  }, [bag.prompt]);
bag.commandMatches = commandMatches as typeof bag.commandMatches;

  /** 技能目录（本地 + 引擎，规范化去重）：技能子面板与输入框「#」技能面板共用同一份数据源，
   *  避免两处各自去重导致同一技能在一处显示、另一处重复。每条都带一句中文注释。 */
  const mergedSkillCatalog = useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; description: string; note: string; path: string }[] = [];
    const push = (entry: { name: string; description?: string; descriptionZh?: string; path?: string; category?: string }) => {
      const key = normSkillName(entry.name);
      if (!key || seen.has(key)) return; // 同名（含插件限定名）只保留第一条（本地优先）
      seen.add(key);
      out.push({ name: shortSkillName(entry.name), description: entry.description ?? "", note: skillZhNote(entry), path: entry.path ?? "" });
    };
    for (const entry of bag.localSkills) push(entry);
    for (const entry of bag.settingsResources.skills) push(entry);
    return out;
  }, [bag.localSkills, bag.settingsResources.skills]);
bag.mergedSkillCatalog = mergedSkillCatalog as typeof bag.mergedSkillCatalog;

  /** 输入框「#」技能面板：与「/」命令面板同款触发条件（以 # 开头且未输入空格）与同款展示效果
   *  （#技能名 + 中文注释），让技能可以直接在输入流里被看见和引用。 */
  const skillCommandMatches = useMemo(
    () => (bag.prompt.startsWith("#") && !bag.prompt.includes(" ") ? matchSkillCatalog(bag.mergedSkillCatalog, bag.prompt.slice(1)) : []),
    [bag.prompt, bag.mergedSkillCatalog],
  );
bag.skillCommandMatches = skillCommandMatches as typeof bag.skillCommandMatches;

  /** ★ 流式性能（09-13）：给「只在内容结构性变化时才需要重算」的 useMemo 用的**稳定键**。
   *  为什么需要它：`thread` 每条 delta 都换引用（mergeItem/mergeTurn 都是不可变更新），
   *  而下面几个 useMemo 会 `flatMap` **全部回合 × 全部 items**、还要对每条消息跑引用解析正则
   *  —— 依赖 `[thread]` 就等于**每帧全量扫描**（5000 回合的会话 = 每帧上万次正则）。
   *  它们的产物只在「会话换了 / 回合数变了 / 末尾条目变了」时才真正需要更新，
   *  所以键取这三样（`turns.length` 覆盖新回合，末尾 item id 覆盖同一回合内的新条目）。 */
  const threadMemoKey = bag.thread ? `${bag.thread.id}:${bag.thread.turns.length}:${bag.thread.turns[bag.thread.turns.length - 1]?.items.at(-1)?.id ?? ""}` : "";
bag.threadMemoKey = threadMemoKey as typeof bag.threadMemoKey;

  const availableContextItems = useMemo(() => {
    if (!bag.thread) return [];
    const query = bag.contextQuery.trim().toLowerCase();
    const entries = bag.thread.turns.flatMap((turn) => turn.items
      .filter((item) => item.type === "userMessage" || item.type === "agentMessage")
      .map((item) => ({ id: item.id, role: item.type === "userMessage" ? "用户" as const : "Codex" as const, text: (item.type === "userMessage" ? userDisplayText(itemText(item)) : itemText(item).trim()) }))
      .filter((item) => item.text));
    return entries.filter((item) => !bag.contextItems.some((selected) => selected.id === item.id))
      .filter((item) => !query || item.text.toLowerCase().includes(query))
      .slice(-16).reverse();
  }, [bag.threadMemoKey, bag.contextItems, bag.contextQuery]);
bag.availableContextItems = availableContextItems as typeof bag.availableContextItems;

  // 「引用对话中的文件」候选：当前会话所有消息里出现过的文件/图片路径（附件段、localImage、文本中的绝对路径）
  const threadFileCandidates = useMemo(() => {
    if (!bag.thread) return [];
    const found: { path: string; source: string }[] = [];
    const push = (path: string, source: string) => {
      const trimmed = path.trim();
      if (!trimmed || /^[a-z]+:\/\//i.test(trimmed) && !/^[a-zA-Z]:\\/.test(trimmed)) return; // 跳过 http(s)/data URL，保留盘符路径
      if (!/[\\/]/.test(trimmed) && !isImagePath(trimmed)) return; // 无路径分隔符的非图片（误抓词）跳过
      found.push({ path: trimmed, source });
    };
    for (const turn of bag.thread.turns) {
      for (const item of turn.items) {
        if (item.type === "localImage" || item.type === "local_image") push(item.path, "图片附件");
        if (item.type === "userMessage") {
          const text = itemText(item);
          for (const m of text.matchAll(/(?:\[附件文件\][\s\S]*?\[附件结束\])|(?:[A-Za-z]:\\[^\s"'\u3001\u3002，。；）]+)|(?:\/(?:Users|home|mnt|opt|var|tmp)\/[^\s"'\u3001\u3002，。；）]+)/g)) {
            const seg = m[0];
            if (seg.startsWith("[附件文件]")) {
              for (const line of seg.split("\n")) {
                const p = line.replace(/^-\s*/, "").trim();
                if (p && !p.startsWith("[")) push(p, "附件");
              }
            } else push(seg, "消息中提及");
          }
          for (const part of (item.content ?? []) as any[]) {
            if (isImagePart(part) && part.path) push(part.path, "图片附件");
          }
        }
      }
    }
    return found.reverse(); // 最新的在前
  }, [bag.threadMemoKey]);
bag.threadFileCandidates = threadFileCandidates as typeof bag.threadFileCandidates;

  function addSystemEvent(title: string, text: string, tone: SystemEvent["tone"] = "info") {
    bag.setSystemEvents((current) => [...current, { id: crypto.randomUUID(), title, text, tone }]);
  }
bag.addSystemEvent = addSystemEvent as typeof bag.addSystemEvent;

  function setCompactEventState(state: "running" | "success" | "error", detail?: string) {
    const content = state === "running"
      ? { message: "正在压缩上下文" }
      : state === "success"
        ? { message: "上下文压缩成功" }
        : { message: detail ? `上下文压缩失败：${detail}` : "上下文压缩失败" };
    const threadId = Array.from(bag.compactPendingRef.current)[0] ?? bag.threadRef.current?.id ?? "";
    bag.setCompactToast({ state, message: content.message, threadId });
  }
bag.setCompactEventState = setCompactEventState as typeof bag.setCompactEventState;

  /** 压缩分隔线只保留最新一条：新一轮压缩开始/完成时，把时间线里更早的 contextCompaction
   *  项从渲染状态中移除（只改本地渲染副本，不动引擎 rollout）。旧「成功」分隔线一直挂着，
   *  新压缩一开始就上下两条叠在一起，被当成多余展示（用户实测）。 */
  function pruneSupersededCompactions(keepId: string) {
    if (!keepId) return;
    bag.setThread((current) => {
      if (!current) return current;
      let changed = false;
      const turns = current.turns.map((turn) => {
        const before = (turn.items ?? []).length;
        const items = (turn.items ?? []).filter((item) => item.type !== "contextCompaction" || String(item.id) === keepId);
        if (items.length !== before) { changed = true; return { ...turn, items }; }
        return turn;
      });
      if (!changed) return current;
      const next = { ...current, turns };
      bag.threadRef.current = next;
      bag.threadCacheRef.current.set(current.id, next);
      return next;
    });
  }
bag.pruneSupersededCompactions = pruneSupersededCompactions as typeof bag.pruneSupersededCompactions;

  // 压缩分隔线：success/error 常驻（用户可手动 × 关闭），running 300s 没收到完成事件才标记失败。
  // 90s 的旧超时会把大上下文的真实模型压缩（几分钟很常见）误判成失败——已实测踩坑。
  useEffect(() => {
    if (!bag.compactToast) return;
    if (bag.compactToast.state === "running") {
      // running 兜底超时：引擎吞请求 / 不发完成事件时不会一直卡住
      const timer = window.setTimeout(() => {
        bag.setCompactToast((current) => current?.state === "running" ? { state: "error", message: "上下文压缩失败：压缩耗时超过 5 分钟仍未返回，可稍后重试 /compact", threadId: current.threadId } : current);
      }, 300000);
      return () => window.clearTimeout(timer);
    }
  }, [bag.compactToast]);

  /** 一次性状态通知：使用现有 toast，不写入对话历史。 */
  /** 会话 id → 侧栏展示名（通知前缀用；查不到给空串=不加前缀）。
   *  09-19 用户：「在别的会话，不知道通知弹窗是哪个会话的」→ 带 threadId 的通知一律前置「【会话名】」。 */
  function threadNameOf(threadId: string): string {
    if (!threadId) return "";
    const entry = bag.threads.find((t) => t.id === threadId);
    // ⛔ 兜底用会话 **id 后 4 位**，不能再用常量「会话」（09-20 用户：「区分不出来哪个是哪个」）：
    //    未命名会话/后台会话/归档会话都会走到兜底，常量兜底会让它们**全部显示成同一个【会话】**，
    //    前缀等于没加。短码唯一，且与侧栏、日志里的会话 id 能对上，方便回查。
    const short = String(threadId).replace(/-/g, "").slice(-4);
    return entry ? cleanThreadDisplayTitle(entry.name, { preview: entry.preview, fallback: short }) : short;
  }
bag.threadNameOf = threadNameOf as typeof bag.threadNameOf;

  /** 会话产生的通知：前置「【会话名】」再进 notice（统一规则，不区分是否当前会话，规则单一无分支）。 */
  function scopedNotice(text: string, threadId?: string) {
    const name = threadId ? bag.threadNameOf(threadId) : "";
    bag.setNotice(name ? `【${name}】${text}` : text);
  }
bag.scopedNotice = scopedNotice as typeof bag.scopedNotice;

  function showToast(title: string, text?: unknown, threadId?: string) {
    const detail = String(text ?? "").replace(/\s+/g, " ").trim();
    const name = threadId ? bag.threadNameOf(threadId) : "";
    const prefix = name ? `【${name}】` : "";
    bag.setNotice(prefix + (detail ? `${title}：${detail.slice(0, 220)}` : title));
  }
bag.showToast = showToast as typeof bag.showToast;

  /** /context 与 /status 共用：估算当前线程上下文占用（本地用法统计 + 回合 usage） */
  function contextUsageText() {
    const windowTokens = Number(bag.customModel?.contextWindow) || 0;
    const agentItems = bag.thread?.turns.flatMap((turn) => turn.items).filter((item) => item.type === "agentMessage") ?? [];
    const userItems = bag.thread?.turns.flatMap((turn) => turn.items).filter((item) => item.type === "userMessage") ?? [];
    const agentChars = agentItems.reduce((sum, item) => sum + (itemText(item) ?? "").length, 0);
    const userChars = userItems.reduce((sum, item) => sum + (itemText(item) ?? "").length, 0);
    const estimated = Math.round((agentChars + userChars) / 3.2); // 中文按 ~3.2 字符/token 估算
    const latestTurn = bag.thread?.turns.at(-1);
    const reported = typeof latestTurn?.usage?.contextTokens === "number" ? latestTurn.usage.contextTokens : typeof latestTurn?.usage?.input_tokens === "number" ? latestTurn.usage.input_tokens : null;
    const total = Math.max(estimated, reported ?? 0);
    const pct = windowTokens ? Math.min(100, Math.round((total / windowTokens) * 100)) : null;
    const stats = readUsageStats();
    const line = windowTokens ? `窗口上限：${formatTokens(windowTokens)} tokens` : "窗口上限：未知";
    const used = `估算占用：${formatTokens(total)} tokens${pct != null ? `（${pct}%）` : ""}`;
    const life = `本地累计：${formatTokens(stats.inputTokens + stats.outputTokens)} tokens · ${stats.turns} 回合`;
    const turn = `当前线程：${bag.thread?.turns.length ?? 0} 回合 · ${agentItems.length} 条回复 · 约 ${formatTokens(estimated)} tokens`;
    const tip = pct != null && pct > 80 ? "⚠️ 上下文接近上限，建议 /compact 压缩或 /new 开新任务。" : "建议上下文占用超过 80% 时执行 /compact 或开启新任务。";
    return [line, used, life, turn, tip].join("\n");
  }
bag.contextUsageText = contextUsageText as typeof bag.contextUsageText;
  return { expandedTeamClusters, setExpandedTeamClusters, toggleTeamCluster, clusteredSidebar, toggleAllSources, sidebarAllCollapsed, toggleAllSidebarSections, TURN_WINDOW, TURNS_PAGE, TURN_WINDOW_MEMORY_KEEP, touchTurnWindow, ANCHOR_TOP_OFFSET_PX, CONTENT_TAIL_GAP_PX, COMMON_COMMAND_ORDER, commandMatches, mergedSkillCatalog, skillCommandMatches, threadMemoKey, availableContextItems, threadFileCandidates, addSystemEvent, setCompactEventState, pruneSupersededCompactions, threadNameOf, scopedNotice, showToast, contextUsageText };
}
