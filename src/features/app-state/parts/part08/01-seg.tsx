/**
 * usePart08a（09-22：part08 按序切分出来的第 1 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { composeScopeInstructions, sessionScopeBlock, sessionScopeSignature } from "../../../../lib/session-scope.mjs";
import { LEGACY_PREFIX, dispatchSignature, emptyDispatch, emptyRuntime, isOwnEcho, legacyMirror, migrateRuntime, normalizeDispatch, normalizeRuntime, patchRuntime, rememberOwnWrite, runtimeKey, runtimeSignature } from "../../../../lib/thread-runtime.mjs";
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "../../../../lib/user-refs";
import { resolveGroupCwd } from "../../../../lib/thread-source.mjs";
import { basename } from "../../../../lib/basename";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../app-view/helpers";
import { DELEGATE_RAIL_LINGER_MS, IDENTITY_ONBOARD_INSTRUCTIONS, IDENTITY_ONBOARD_TOOL, MEMBER_LABELS, NOTICE_MAX, NOTICE_TTL_MS, QUICK_SITES } from "../../../app-view/constants";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../app-view/types";
import type { Bag } from "../bag-types";
import { openThread as openThreadImpl } from "./01-seg/open-thread";

export function usePart08a(bag: Bag) {function openThread(id: string, freshThread?: Thread | null) {
  return openThreadImpl(bag, id, freshThread);
}

bag.openThread = openThread as typeof bag.openThread;

  /** 归档/删除团队主会话时**级联**处理同簇成员会话（09-14 用户：主会话归档/删除了，侧栏团队条还在）。
   *  根因：成员子线程是主理人调度时新建的长期会话，主会话没了就成了孤儿，聚簇兜底会继续
   *  把它们归在团队名下 → 团队条永远不消失。逐个容错，单个失败不阻塞其余。 */
  const cascadeTeamCluster = async (id: string, action: "archive" | "delete") => {
    const cluster = bag.clusteredSidebar.clusters.find((entry) => entry.lead?.id === id);
    if (!cluster?.members.length) return 0;
    let done = 0;
    for (const member of cluster.members) {
      try {
        await window.codex.request(action === "archive" ? "thread/archive" : "thread/delete", { threadId: member.id });
        bag.threadCacheRef.current.delete(member.id);
        done += 1;
      } catch { /* 单个失败不阻塞其余 */ }
    }
    if (done) bag.setThreads((current) => current.filter((entry) => !cluster.members.some((m) => m.id === entry.id)));
    return done;
  };
bag.cascadeTeamCluster = cascadeTeamCluster as typeof bag.cascadeTeamCluster;

  async function archiveThread(id: string) {
    // 归档后提示（09-17 用户要求）：先取名字（归档后列表里就查不到了）
    const archivedName = bag.threadsRef.current.find((entry) => entry.id === id)?.name
      || bag.threadCacheRef.current.get(id)?.name
      || "当前会话";
    await bag.cascadeTeamCluster(id, "archive");
    await window.codex.request("thread/archive", { threadId: id });
    bag.setThreads((current) => current.filter((entry) => entry.id !== id));
    bag.threadCacheRef.current.delete(id);
    if (bag.threadRef.current?.id === id) {
      // 归档当前会话 = 回到全新会话：必须走 startNewThread 完整复位。
      // 之前手工清了一堆状态但漏了 sending/interrupting——会话在运行中被归档后
      // sending 卡 true，发送按钮永远是「停止」，输入框发不出消息。
      bag.startNewThread();
      requestAnimationFrame(() => bag.composerInputRef.current?.focus());
    }
    // 提示浮层（**窗口正中间** / 3 秒自动消失 / 可手动关，09-23 改）；token 递增保证连续归档都拿到完整 3 秒
    bag.setArchiveToast((current) => ({ name: archivedName, token: (current?.token ?? 0) + 1 }));
  }
bag.archiveThread = archiveThread as typeof bag.archiveThread;

  async function renameThread(id: string, value: string) {
    const name = value.trim();
    if (!name) return;
    // ⛔ 名字**先落本地覆盖表**（它才是权威）：引擎那份 `name` 会被「该会话第一条用户消息」
    //    顶掉（实测，见 nameOverrides 注释），所以不能反过来依赖引擎回包来显示。
    bag.rememberThreadName(id, name);
    const applyName = (entry: Thread) => entry.id === id ? { ...entry, name } : entry;
    bag.setThreads((current) => current.map(applyName));
    const cached = bag.threadCacheRef.current.get(id);
    if (cached) bag.threadCacheRef.current.set(id, applyName(cached));
    if (bag.threadRef.current?.id === id) {
      const next = applyName(bag.threadRef.current);
      bag.threadRef.current = next;
      bag.setThread(next);
    }
    // 引擎侧只是**尽力同步**（别的客户端 / 引擎自己的标题机制还看它），失败不回滚本地改名。
    let engineError: any = null;
    try { await window.codex.request("thread/name/set", { threadId: id, name }); }
    catch (error: any) { engineError = error; }
    await bag.refreshThreads().catch(() => undefined);
    // ⛔ 措辞必须说清「哪一侧没同步」：改名在本地已经生效，说「重命名失败」会让用户以为白改了
    //    （这正是本 bug 的观感来源之一 —— 引擎侧那份名字随后还会被首条消息顶掉）。
    if (engineError) bag.setNotice(`已改名（引擎侧未同步：${engineError.message}）`);
  }
bag.renameThread = renameThread as typeof bag.renameThread;

  async function clearCurrentConversation() {
    const id = bag.threadRef.current?.id;
    if (!id) return;
    try {
      await window.codex.request("thread/delete", { threadId: id });
    bag.forgetThreadMood(id);
      bag.threadCacheRef.current.delete(id);
      bag.setThreads((current) => current.filter((entry) => entry.id !== id));
      bag.startNewThread();
      await bag.refreshThreads();
      requestAnimationFrame(() => bag.composerInputRef.current?.focus());
      bag.showToast("对话记录已清空", "当前会话已永久删除，可以直接开始新对话");
    } catch (error: any) {
      bag.showToast("清空对话失败", error.message);
    }
  }
bag.clearCurrentConversation = clearCurrentConversation as typeof bag.clearCurrentConversation;

  async function unarchiveThread(id: string) {
    await window.codex.request("thread/unarchive", { threadId: id });
    bag.setThreads((current) => current.filter((entry) => entry.id !== id));
  }
bag.unarchiveThread = unarchiveThread as typeof bag.unarchiveThread;

  /** 删除会话的**无确认内核**：级联成员会话 + 引擎删除 + 本地缓存/侧栏清理 + 当前会话状态复位。
   *  拆出来是为了让「一键释放调度」（它有自己的确认文案）复用同一条级联链路 —— 删一个会话
   *  必须把它的**衍生状态**一起带走：专家团成员会话、会话缓存、供应商登记、当前会话的
   *  运行/计划/目标状态。⛔ 别在别处再写一份简版删除（漏一项就是孤儿）。 */
  async function deleteThreadCore(id: string) {
    await bag.cascadeTeamCluster(id, "delete");
    await window.codex.request("thread/delete", { threadId: id });
    bag.forgetThreadMood(id);
    bag.threadCacheRef.current.delete(id);
    bag.threadProviderRef.current.delete(id);
    bag.setThreads((current) => current.filter((entry) => entry.id !== id));
    if (bag.threadRef.current?.id === id) {
      bag.threadRef.current = null;
      bag.setThread(null);
      bag.setOptimisticInput(null);
      bag.setActiveTurnId(null);
      bag.markThreadStopped(id);
      bag.setWorkStartedAt(null);
      bag.setSystemEvents([]);
      bag.setPlanSteps([]);
      bag.setGoalText("");
    }
  }
bag.deleteThreadCore = deleteThreadCore as typeof bag.deleteThreadCore;

  async function deleteThread(id: string) {
    const cluster = bag.clusteredSidebar.clusters.find((entry) => entry.lead?.id === id);
    const memberCount = cluster?.members.length ?? 0;
    const extra = memberCount ? `\n\n这是「专家团」主会话，将同时永久删除其 ${memberCount} 条成员会话。` : "";
    if (!await bag.openAppConfirm("删除会话", `当前会话及其中的消息、工具记录将被永久删除，此操作无法撤销。${extra}`, "永久删除")) return;
    bag.setOpeningThread(id);
    try {
      await bag.deleteThreadCore(id);
    } catch (error: any) {
      bag.setNotice(`删除任务失败：${error.message}`);
    } finally {
      bag.setOpeningThread(null);
    }
  }
bag.deleteThread = deleteThread as typeof bag.deleteThread;

  /** ⛔ 一键释放调度（用户 09-17 要求：「在调度里面加一个主动释放功能，一键释放后删除旧的调度会话」）:
   *  把全局唯一的调度权从旧持有者手里**收回**，并**删除那条旧调度会话**（级联走 deleteThreadCore）。
   *
   *  为什么需要这个显式入口：持有者是从 thread-runtime 记录**派生**的（第一个 dispatch.enabled 的
   *  线程），而会话被归档/删除时历史上没有任何地方清这条记录 ⇒ 孤儿记录永久占着全局唯一的调度权，
   *  且那条会话往往在侧栏上已经找不到（用户原话：「都关掉了，怎么还提示被锁住了」）。
   *  自动自愈只覆盖「持有者已不在会话列表」的情形；持有者仍在侧栏、用户就是想把它清掉时靠这里。
   *
   *  顺序刻意是「**先释放、后删除**」：万一删除失败（比如引擎那边正在跑），用户至少已经拿回了调度权。
   *  这条路径也会连带清掉 thread-runtime 记录（主进程 thread/deleted 事件 → remove），不再留孤儿。 */
  async function releaseDispatchHolder() {
    const holderId = bag.dispatchOwnerId;
    if (!holderId) return;
    const holder = bag.threads.find((entry) => entry.id === holderId);
    const name = holder ? (cleanThreadDisplayTitle(holder.name, { preview: holder.preview })?.trim() || "另一个会话") : "";
    const who = holder ? `「${name}」` : "那条已不在列表里的旧会话";
    const note = holder ? "" : "（它已不在会话列表里，这里只会清掉残留的调度占用）";
    if (!await bag.openAppConfirm(
      "释放并删除调度会话",
      `将收回调度权限，并永久删除占用者${who}及其全部消息与工具记录 —— 此操作无法撤销。${note}`,
      "释放并删除",
    )) return;
    bag.setDispatchBusy(true);
    try {
      await window.codex.releaseDispatch(holderId);   // ① 先夺回调度权（即使②失败也已解锁）
      if (holder) await bag.deleteThreadCore(holderId);   // ② 再把旧会话连同衍生态一起删掉
      else {
        bag.threadCacheRef.current.delete(holderId);
        bag.setThreads((current) => current.filter((entry) => entry.id !== holderId));
      }
      bag.showToast("调度已释放", holder ? `「${name}」已删除，现在可以在本会话开启调度` : "残留的调度占用已清掉");
    } catch (error: any) {
      bag.setNotice(`释放调度失败：${error.message ?? error}`);
    } finally {
      bag.setDispatchBusy(false);
      await bag.refreshDispatchOwner().catch(() => undefined);
      void bag.refreshThreads();
    }
  }
bag.releaseDispatchHolder = releaseDispatchHolder as typeof bag.releaseDispatchHolder;

  async function deleteThreadsByCwd(cwd: string) {
    /* ⛔ 必须按**有效 cwd**（侧栏项目视图的归组口径）取目标 —— 09-25 加「被调度会话跟随主对话
       项目地址」后，一个项目组里含 own cwd 不同的被调度会话。仍按 entry.cwd 过滤会有两个错：
       ① 组里看得见的被调度会话删不掉（留在原地变孤儿行）② 反把 own cwd 命中但已归到**别的**
       项目下的会话删掉（用户没在该项目里看到它）。
       ⛔ 直接复用 part03 算好的 `bag.dispatchCwdMap`（**同一份口径**，别在这里重算）——
       重算等于留第二份会漂移的真相源（09-25 代码审查）。part08 在 part03 之后运行，映射已就绪。 */
    const cwdMap = bag.dispatchCwdMap ?? {};
    const ids = bag.threads.filter((entry) => (cwdMap[entry.id] ?? entry.cwd) === cwd).map((entry) => entry.id);
    if (!ids.length) { bag.setNotice("该项目下已无对话"); return; }
    if (!(await bag.openAppConfirm("删除整个项目", `项目「${basename(cwd)}」下的 ${ids.length} 条任务将被永久删除，此操作无法撤销。`, "永久删除"))) return;
    for (const id of ids) {
      try {
        await window.codex.request("thread/delete", { threadId: id });
    bag.forgetThreadMood(id);
        bag.threadCacheRef.current.delete(id);
      } catch (error: any) {
        bag.setNotice(`删除任务失败：${error.message ?? error}`);
      }
    }
    const removed = new Set(ids);
    bag.setThreads((current) => current.filter((entry) => !removed.has(entry.id)));
    if (bag.threadRef.current && removed.has(bag.threadRef.current.id)) {
      bag.threadRef.current = null;
      bag.setThread(null);
      bag.setOptimisticInput(null);
      bag.setActiveTurnId(null);
      for (const id of ids) bag.markThreadStopped(id);
      bag.setWorkStartedAt(null);
      bag.setSystemEvents([]);
      bag.setPlanSteps([]);
      bag.setGoalText("");
    }
    if (bag.projectFilter === cwd) bag.setProjectFilter(null);
  }
bag.deleteThreadsByCwd = deleteThreadsByCwd as typeof bag.deleteThreadsByCwd;

  /** 动态工具面（thread/start 与 thread/resume 共用）：引擎 resume 的 schema 实证也接受
   *  dynamicTools——不带上 = 旧会话恢复的是创建时的工具快照，新工具（如技能纪律四件套）
   *  永远进不去（Codex 反馈「我工具列表里没有 skill_search」的根因）。 */
  const buildDynamicTools = useCallback(async (): Promise<any[]> => {
    const builtinCfg = await window.codex.readBuiltinPlugins().catch(() => null);
    // 调度（L2 注册侧）：只有「用户直连会话」才拿到 agent_invoke —— 被调度出来的会话再拿到它
    // 就会套娃。主进程另有 L3 硬闸兜底（给了也不认），这里只是不给，少给模型一次犯错机会。
    const dispatchThreadId = bag.threadRef.current?.id ?? "";
    const dispatchIsDelegated = Boolean(dispatchThreadId && bag.delegateRecordsRef.current[dispatchThreadId]);
    const dispatchSwitch = dispatchThreadId ? loadThreadRuntime(dispatchThreadId).dispatch : emptyDispatch();
    return [
      ...(builtinCfg?.image?.enabled !== false && builtinCfg?.image?.baseUrl ? [{
        type: "function",
        name: "generate_image",
        description: "生成一张图片，返回图片的本地文件路径。用于用户要求画图、配图、示意图等场景。展示给用户请用 markdown 图片语法引用该路径（![描述](路径)）；要看图片内容用 view_image 传该路径。",
        inputSchema: { type: "object", properties: { prompt: { type: "string", description: "图片内容的详细描述（含风格、主体、构图）" } }, required: ["prompt"] },
      }] : []),
      ...(builtinCfg?.vision?.enabled !== false && builtinCfg?.vision?.baseUrl ? [{
        type: "function",
        name: "describe_image",
        description: "当你看不清或无法解析用户提供的图片内容时，调用此工具让视觉模型描述图片并把结果作为依据继续回答。",
        inputSchema: { type: "object", properties: { imageUrl: { type: "string", description: "图片的本地文件路径或 http(s) 地址（本地图片直接传路径，会自动读取；生成/保存下来的图片就用它的路径）。⛔ 不要传 data URL —— 内联 base64 会把几 MB 文本灌进对话历史" }, prompt: { type: "string", description: "你想让视觉模型关注的问题，可省略" } }, required: ["imageUrl"] },
      }] : []),
      ...(bag.memoryEnabled ? [
        { type: "function", name: "memory_recall", description: "按当前任务查询相关的分类记忆。", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
        { type: "function", name: "memory_save", description: "保存可复用的项目事实，必须选择分类。", inputSchema: { type: "object", properties: { category: { type: "string", enum: ["用户偏好", "项目背景", "工作流/SOP", "任务经验", "临时上下文"] }, content: { type: "string" } }, required: ["category", "content"] } },
      ] : []),
      // 子智能体：委派会话不注册（它自己就是被调起来的，再往下调就是套娃）
      ...(dispatchIsDelegated ? [] : subAgentTools(bag.subAgents)),
      // ⛔ 调度工具（agent_invoke / agent_archive_sessions）已改走内置 MCP（harness-dispatch）：
      //    dynamicTools 只在 thread/start 生效（引擎硬约束），对老会话永远不可见；MCP 引擎级注入
      //    覆盖所有会话，闸收敛到主进程执行端。这里不再注册，避免同名双工具让模型混乱。
      // RPA 配方与任务清单：让 agent 能存配方/跑配方/维护清单/向用户提问
      { type: "function", name: "rpa_save", description: "把刚跑通的一条自动化流程保存为 RPA 配方，下次可直接复用执行。steps 按顺序写清每一步（网址/点击/输入/桌面操作等），kind 选 browser（浏览器）/desktop（桌面）/mixed。", inputSchema: { type: "object", properties: { name: { type: "string", description: "配方名称，如「每天导出日报」" }, desc: { type: "string", description: "一句话说明用途" }, kind: { type: "string", enum: ["browser", "desktop", "mixed"] }, steps: { type: "array", items: { type: "string" }, description: "按顺序的执行步骤" }, target: { type: "string", description: "起始网址或目标程序，可省略" } }, required: ["name", "steps", "kind"] } },
      { type: "function", name: "rpa_run", description: "列出已保存的 RPA 配方（不传 name），或按名称执行某条配方。执行时按 steps 逐步复现自动化流程。", inputSchema: { type: "object", properties: { name: { type: "string", description: "要执行的配方名称；省略则返回全部配方清单" } } } },
      { type: "function", name: "task_add", description: "把一条任务加入用户的任务清单。", inputSchema: { type: "object", properties: { text: { type: "string" }, priority: { type: "string", enum: ["low", "medium", "high"] } }, required: ["text"] } },
      { type: "function", name: "task_update", description: "更新任务清单：列出全部任务（不传任何参数）、改状态或删除。status 只有 todo/doing/done。", inputSchema: { type: "object", properties: { id: { type: "string" }, status: { type: "string", enum: ["todo", "doing", "done"] }, text: { type: "string" }, priority: { type: "string", enum: ["low", "medium", "high"] }, done: { type: "boolean", description: "删除任务" } } } },
      { type: "function", name: "agent_ask", description: "在对话里向用户展示一组选项并等待选择（提问时必须给出选项）。options 里第一项会作为推荐项高亮，也可以留空让用户自由输入。", inputSchema: { type: "object", properties: { question: { type: "string", description: "要问用户的问题" }, options: { type: "array", items: { type: "string" }, description: "2-4 个候选选项，第一项为推荐" }, allowFree: { type: "boolean", description: "是否允许自由输入，默认允许" } }, required: ["question", "options"] } },
      // 技能运用纪律：缺技能自主搜市场/安装，缺连接器先查模板（安装前必须 agent_ask 征得同意）
      { type: "function", name: "skill_search", description: "在内置技能市场按关键词搜索技能（返回名称/简介/安装状态）。当任务没有合适技能、你想找现成技能提效时调用。", inputSchema: { type: "object", properties: { query: { type: "string", description: "关键词，如 excel、爬虫、pdf" } }, required: ["query"] } },
      { type: "function", name: "skill_install", description: "从技能市场安装一个技能（不重启应用，下一回合即可用）。传 query 自动匹配最相似的技能；装完先读它的 SKILL.md 再按说明书使用。", inputSchema: { type: "object", properties: { query: { type: "string", description: "技能名或关键词，优先用 skill_search 结果里的准确名称" } }, required: ["query"] } },
      { type: "function", name: "connector_search", description: "列出内置 MCP 连接器模板与已配置状态（浏览器自动化、桌面自动化、GitHub 等）。需要某种外部服务能力但当前没有对应工具时调用。", inputSchema: { type: "object", properties: { query: { type: "string", description: "过滤关键词，可省略" } } } },
      { type: "function", name: "connector_install", description: "安装一个 MCP 连接器模板（写入配置并重启引擎，会中断当前回合）。必须先用 agent_ask 征得用户同意才能调用；安装后提醒用户重新发一条消息继续。", inputSchema: { type: "object", properties: { templateId: { type: "string", description: "connector_search 结果里的模板 id" } }, required: ["templateId"] } },
    ];
  }, [bag.memoryEnabled, bag.subAgents]);
bag.buildDynamicTools = buildDynamicTools as typeof bag.buildDynamicTools;

  async function createEmptyThread(): Promise<Thread | null> {
    const dynamicTools = await bag.buildDynamicTools();
    // 首次对话身份引导：**只在「从没打过招呼」时注入一次**（09-12 用户反馈修正）。
    // 旧判定用 `onboarded`（用户真的回答了才为 true）→ 不回答的用户每个新会话都被
    // 强制引导一遍。现在只要问过一次就落 `greeted=true`，后续新会话一律不带引导，
    // 直接开始干活。
    const shouldGreet = bag.identityGreeted === false;
    if (shouldGreet) {
      dynamicTools.push(IDENTITY_ONBOARD_TOOL as unknown as (typeof dynamicTools)[number]);
      // 落标记：本轮之后的新会话不再引导。失败也不影响本次发送（内存里也置 true）。
      void window.codex.markIdentityGreeted?.().catch(() => undefined);
      bag.setIdentityGreeted(true);
    }
    const memoryTools = dynamicTools.length ? { dynamicTools } : {};
    const onboardingInstructions = shouldGreet ? IDENTITY_ONBOARD_INSTRUCTIONS : null;
    // 新建会话即刻带上「会话作用域」（此时会话 ID 还没生成 → 块里标「未登记」，
    // thread/start 成功后由 pushSessionScope 用真实 ID 再补一发）。三段共存：全局基线 +
    // 会话作用域 + 引导语，顺序固定，避免把语言/内置工具说明或引导语顶掉。
    const scopeSeed = composeScopeInstructions(await bag.loadBaseInstructions(), sessionScopeBlock({
      threadId: "",
      model: bag.selectedModel?.model ?? modelName(bag.modelId) ?? "",
      provider: String(bag.customModel?.provider ?? ""),
      effort: String(bag.effort ?? ""),
      sandbox: String(bag.sandbox ?? ""),
      approval: String(bag.approvalPolicy ?? ""),
      workspace: String(bag.welcomeScratchDir ?? bag.workspace ?? ""),
    }));
    const developerInstructions = [scopeSeed, onboardingInstructions].filter(Boolean).join("\n\n");
    const started = await window.codex.request("thread/start", {
      model: bag.selectedModel?.model ?? modelName(bag.modelId),
      // 欢迎页「无项目」模式：本会话用自动创建的独立临时目录（每个会话单独一个）；
      // 正常模式跟随全局项目地址。会话建立后清掉 scratch 记录——下次再选「无项目」
      // 会新建另一个目录，实现「每次新建单独目录」。
      cwd: bag.welcomeScratchDir ?? bag.workspace,
      approvalPolicy: bag.approvalPolicy,
      sandbox: bag.sandbox,
      sandboxPolicy: sandboxPolicy(bag.sandbox, bag.welcomeScratchDir ?? bag.workspace),
      personality: bag.selectedModel?.supportsPersonality ? bag.personality : null,
      developerInstructions,
      ...bag.providerConfig,
      ...memoryTools,
    });
    if (bag.welcomeScratchDir) bag.setWelcomeScratchDir(null);
    const active = started.thread as Thread;
    bag.threadRef.current = active;
    bag.setThread(active);
    if (started?.thread?.id) {
      // ⛔ 多会话/多窗口作用域（09-13 收尾）：新建会话时把「创建那一刻的全局默认」
      // **烙成该会话自己的初始记录**（模型/effort/权限）。此后该会话的回填与重启兜底
      // 全部走会话级键，不再读全局——彻底切断「其他会话后来改全局默认」的污染路径。
      // （thread/start 传入的 model/effort/sandbox/approval 就是这些全局值，烙进去与
      //   引擎侧会话创建时的真实状态一致。）
      const tid = started.thread.id;
      if (!loadThreadModel(tid)) saveThreadModel(tid, bag.modelId);
      if (!loadThreadEffort(tid) && bag.effort) saveThreadEffort(tid, bag.effort);
      saveThreadPermissions(tid, bag.sandbox, bag.approvalPolicy);
      // 会话作用域用真实会话 ID 补发一发（thread/start 那发块里会话 ID 只能标「未登记」）：
      // 空会话此刻可能还没有 rollout，失败也无所谓——首次发消息时 updateThreadSettings 会再补。
      void bag.pushSessionScope(tid);
    }
    return active;
  }
bag.createEmptyThread = createEmptyThread as typeof bag.createEmptyThread;
  return { openThread, cascadeTeamCluster, archiveThread, renameThread, clearCurrentConversation, unarchiveThread, deleteThreadCore, deleteThread, releaseDispatchHolder, deleteThreadsByCwd, buildDynamicTools, createEmptyThread };
}
