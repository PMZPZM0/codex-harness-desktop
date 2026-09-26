/**
 * usePart05a（09-22：part05 按序切分出来的第 1 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import { isCompactionItem } from "../../../../lib/compaction-item.mjs";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { translateEngineNotice } from "../../../../lib/engine-notices-zh";
import { performRelayLogin, resolveRelayAutoTarget, resolveRelayTarget, resolveRelayKeyTarget, writeRelayActive, readRelayActive, type RelayActive } from "../../../../lib/relay";
import {
  ponytailSubSkills, planAction, applyAction, isEmptyAction, describePartial, guardOffOwner,
  findCapabilitySkill, findCapabilitySkills, syncedSnapshot, samePluginId,
  PONYTAIL_PLUGIN_ID, NUPHUS_MCP_ID, DESKTOP_SKILL_ID, BROWSER_SKILL_ID, BROWSER_SKILL_IDS, GROUP_LABELS,
  type CapabilityGroupId, type SubToggleSnapshot, type GroupIpc, type MemberKey,
} from "../../../../lib/capability-groups";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../app-view/helpers";
import { DELEGATE_RAIL_LINGER_MS, IDENTITY_ONBOARD_INSTRUCTIONS, IDENTITY_ONBOARD_TOOL, MEMBER_LABELS, NOTICE_MAX, NOTICE_TTL_MS, QUICK_SITES } from "../../../app-view/constants";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../app-view/types";
import type { Bag } from "../bag-types";
import { handleEventRouter1 } from "./event-router/01-status";
import { handleEventRouter2 } from "./event-router/02-request";
import { handleEventRouter3 } from "./event-router/03-thread-id";
import { handleEventRouter4 } from "./event-router/04-thread-stream-method";
import { handleEventRouter5 } from "./event-router/05-turn-completed-notify";
import { handleEventRouter6 } from "./event-router/06-turn-started";
import { handleEventRouter7 } from "./event-router/07-turn-completed-settle";
import { handleEventRouter8 } from "./event-router/08-error";
import { handleEventRouter9 } from "./event-router/09-thread-settings-updated";

export function usePart05a(bag: Bag) {
  async function changePlugin(plugin: any) {
    const key = String(plugin.name ?? plugin.id ?? "");
    bag.setPluginBusy(key);
    try {
      if (plugin.installed && plugin.id) {
        await window.codex.request("plugin/uninstall", { pluginId: plugin.id });
      } else {
        await window.codex.request("plugin/install", { pluginName: plugin.name, ...(plugin.marketplacePath ? { marketplacePath: plugin.marketplacePath } : { remoteMarketplaceName: plugin.marketplaceName }), installAttemptId: crypto.randomUUID() });
      }
      await bag.refreshSettingsResources();
      bag.setNotice(`插件「${plugin.name}」${plugin.installed ? "已卸载" : "已安装"}`);
    } catch (error: any) {
      // 官方精选市场（openai-api-curated）的插件需要 ChatGPT 账号登录才能装，给明确中文提示
      const msg = String(error.message ?? error);
      if (/chatgpt authentication|remote plugin catalog|requires.*auth/i.test(msg)) {
        bag.setNotice(`插件「${plugin.name}」来自 OpenAI 官方精选市场，需要先登录 ChatGPT 账号（API Key 方式装不了）。要离线内置插件请找我们随包分发。`);
      } else {
        bag.setNotice(`插件操作失败：${msg}`);
      }
    } finally { bag.setPluginBusy(null); }
  }
bag.changePlugin = changePlugin as typeof bag.changePlugin;

  /** 插件启停：写入 config.toml 的 [plugins."<id>"] enabled，Codex 下一轮扫描起不再加载被停用的插件 */
  async function setPluginEnabled(plugin: any, enabled: boolean) {
    const id = String(plugin.id ?? plugin.name ?? "");
    if (!id) return;
    if (bag.guardGroupOff({ kind: "plugin", id }, `插件「${pluginDisplayName(plugin)}」`, enabled)) return;
    bag.setPluginBusy(id);
    try {
      const result = await window.codex.setPluginEnabled({ pluginIds: [id], enabled });
      if (result.failures?.length) throw new Error(result.failures.join("；"));
      await bag.refreshSettingsResources();
      bag.setNotice(`插件「${pluginDisplayName(plugin)}」已${enabled ? "启用" : "停用"}`);
    } catch (error: any) { bag.setNotice(`插件${enabled ? "启用" : "停用"}失败：${error.message}`); }
    finally { bag.setPluginBusy(null); }
  }
bag.setPluginEnabled = setPluginEnabled as typeof bag.setPluginEnabled;

  // —— 能力总闸联动：写代码模式 / 桌面自动化 / 浏览器自动化 —— //
  // 派生快照：主开关状态完全由子项状态实时计算（不存 useState），杜绝主/子状态漂移
  const ponytailPluginEntry = useMemo(
    () => (bag.settingsResources.plugins as any[]).find((plugin) => plugin.installed && samePluginId(plugin.id, PONYTAIL_PLUGIN_ID)),
    [bag.settingsResources.plugins],
  );
bag.ponytailPluginEntry = ponytailPluginEntry as typeof bag.ponytailPluginEntry;

  const ponytailPluginOn = bag.ponytailPluginEntry?.enabled !== false;
bag.ponytailPluginOn = ponytailPluginOn as typeof bag.ponytailPluginOn;

  const ponytailSkillsSnap = useMemo(() => ponytailSubSkills(bag.localSkills as any[]), [bag.localSkills]);
bag.ponytailSkillsSnap = ponytailSkillsSnap as typeof bag.ponytailSkillsSnap;

  const desktopSkillSnap = useMemo(() => findCapabilitySkill(bag.localSkills as any[], DESKTOP_SKILL_ID), [bag.localSkills]);
bag.desktopSkillSnap = desktopSkillSnap as typeof bag.desktopSkillSnap;

  const browserSkillsSnap = useMemo(() => findCapabilitySkills(bag.localSkills as any[], BROWSER_SKILL_IDS), [bag.localSkills]);
bag.browserSkillsSnap = browserSkillsSnap as typeof bag.browserSkillsSnap;

  const nuphusMcpOn = bag.mcpOverrides[NUPHUS_MCP_ID] !== false;
bag.nuphusMcpOn = nuphusMcpOn as typeof bag.nuphusMcpOn;

 // 覆盖表没记录 = 默认启用
  const capabilitySnapshot: SubToggleSnapshot = useMemo(() => ({
    ponytailOn: bag.ponytailOn,
    ponytailPluginOn: bag.ponytailPluginOn,
    ponytailSkills: bag.ponytailSkillsSnap,
    desktopAuto: bag.desktopAuto,
    browserAuto: bag.browserAuto,
    nuphusMcpOn: bag.nuphusMcpOn,
    desktopSkill: bag.desktopSkillSnap,
    browserSkills: bag.browserSkillsSnap,
  }), [bag.ponytailOn, bag.ponytailPluginOn, bag.ponytailSkillsSnap, bag.desktopAuto, bag.browserAuto, bag.nuphusMcpOn, bag.desktopSkillSnap, bag.browserSkillsSnap]);
bag.capabilitySnapshot = capabilitySnapshot as typeof bag.capabilitySnapshot;

  const [groupBusy, setGroupBusy] = useState<CapabilityGroupId | null>(null);
bag.groupBusy = groupBusy as typeof bag.groupBusy; bag.setGroupBusy = setGroupBusy as typeof bag.setGroupBusy;

  /** 联动层 IPC 实现（抽出来给「启动自愈」复用）。 */
  const groupIpc: GroupIpc = {
    ponytailModeSet: (mode) => window.codex.ponytailModeSet(mode) as Promise<unknown>,
    setPluginLinkedEnabled: (id, enabled) => window.codex.setPluginLinkedEnabled({ pluginId: id, enabled }),
    saveAppSettings: (patch) => window.codex.saveAppSettings(patch as any),
    setMcpServersEnabled: (ids, enabled) => window.codex.setMcpServersEnabled(ids, enabled),
    setSkillEnabled: (input) => window.codex.setEnabledSkill(input),
  };
bag.groupIpc = groupIpc as typeof bag.groupIpc;

  /**
   * 能力总闸联动入口：「常规」页三个开关共用。一次性把该组的所有子项对齐到 target：
   * - writing-code：ponytail 注入开关 + ponytail 插件（含钩子与 6 个子技能）
   * - desktop-automation：app-settings 总闸 + nuphus MCP 启停 + desktop-automation 技能
   * - browser-automation：app-settings 总闸 + browser-automation 技能
   * 失败项聚合返回 toast；silent=true 时完全不提示（启动自愈用）。
   */
  async function applyGroup(groupId: CapabilityGroupId, target: boolean, silent = false) {
    bag.setGroupBusy(groupId);
    try {
      const plan = planAction(bag.capabilitySnapshot, groupId, target);
      if (isEmptyAction(plan)) return;
      const result = await applyAction(plan, bag.groupIpc);
      if (groupId === "writing-code") bag.setPonytailOn(target);
      else if (groupId === "desktop-automation") bag.setDesktopAuto(target);
      else bag.setBrowserAuto(target);
      await Promise.all([
        bag.refreshSettingsResources(),
        window.codex.listLocalSkills().then(bag.setLocalSkills),
        window.codex.readMcpServerOverrides().then(bag.setMcpOverrides).catch(() => undefined),
      ]);
      if (silent) return;
      const label = GROUP_LABELS[groupId];
      if (result.failures.length) {
        bag.setNotice(`${label}部分联动失败：${result.failures.join("；")}`);
        return;
      }
      const parts: string[] = [];
      if (result.applied.ponytailMode) parts.push("注入开关");
      if (result.applied.ponytailLinked) parts.push("ponytail 插件与子技能");
      if (result.applied.nuphus) parts.push("nuphus MCP");
      if (result.applied.desktopSkill) parts.push(`${DESKTOP_SKILL_ID} 技能`);
      if (result.applied.browserSkill) parts.push("浏览器自动化技能");
      // 联动后再复算一次：还有没带起来的子项（例如技能目录被改名）就点名提示
      const hint = describePartial(syncedSnapshot(bag.capabilitySnapshot, groupId, target), groupId, MEMBER_LABELS);
      if (hint) bag.setNotice(`${label}已${target ? "开启" : "关闭"}，但 ${hint.pendingLabels.join("、")} 未同步，请到对应页确认`);
      else bag.setNotice(`${label}已${target ? "开启" : "关闭"}${parts.length ? `（已同步 ${parts.join("、")}）` : ""}`);
    } catch (error: any) {
      if (!silent) bag.setNotice(`${GROUP_LABELS[groupId]}联动失败：${error?.message ?? String(error)}`);
    } finally { bag.setGroupBusy(null); }
  }
bag.applyGroup = applyGroup as typeof bag.applyGroup;

  // 启动自愈：总闸开着但配套 MCP / 技能是关的（旧版默认值或历史手工关停），一次性补齐，
  // 保证「常规页开着 == 引擎真能用」。每次启动只跑一次，且不弹提示。
  const bootHealRef = useRef(false);
bag.bootHealRef = bootHealRef as typeof bag.bootHealRef;

  /* 上下文环只反映**当前正在看的会话**（09-25 用户报「一切换供应商就爆了上下文」）：
     切会话时把显示值换成该会话自己那一份快照（没有就清空 ⇒ 环显示「用量待同步」），
     ⛔ 不许把上一个会话的数字留着 —— 那正是"粘在环上的大数字"的来源。 */
  useEffect(() => {
    const activeId = String(bag.thread?.id ?? "");
    const snapshot = activeId ? bag.tokenUsageByThreadRef.current.get(activeId) ?? null : null;
    bag.tokenUsageRef.current = snapshot;
    bag.setTokenUsage(snapshot);
  }, [bag.thread?.id]);

  useEffect(() => {
    if (bag.bootHealRef.current) return;
    bag.bootHealRef.current = true;
    void (async () => {
      try {
        const [skills, overrides, settings, pluginMode, pluginResult] = await Promise.all([
          window.codex.listLocalSkills(),
          window.codex.readMcpServerOverrides().catch(() => ({}) as Record<string, boolean>),
          window.codex.readAppSettings().catch(() => ({}) as Record<string, unknown>),
          // 写代码模式真实落盘状态：~/.config/ponytail/config.json:defaultMode。
          // 不能拿 ponytailOn 的 useState 默认值当真——那只是 UI 初始值，不是落盘状态。
          (window.codex.ponytailModeGet?.() ?? Promise.resolve("full")).catch(() => "full"),
          window.codex.request("plugin/list", { cwds: bag.workspace ? [bag.workspace] : [], forceRefetch: false }).catch(() => ({ marketplaces: [] })),
        ]);
        const ponytailPluginEntry = ((pluginResult.marketplaces ?? []) as any[])
          .flatMap((marketplace: any) => marketplace.plugins ?? [])
          .find((plugin: any) => plugin.installed && samePluginId(plugin.id, PONYTAIL_PLUGIN_ID));
        const snapshot: SubToggleSnapshot = {
          ponytailOn: pluginMode !== "off",
          ponytailPluginOn: ponytailPluginEntry?.enabled !== false,
          ponytailSkills: ponytailSubSkills(skills as any[]),
          desktopAuto: settings.desktopAutomation !== false,
          browserAuto: settings.browserAutomation !== false,
          nuphusMcpOn: overrides[NUPHUS_MCP_ID] !== false,
          desktopSkill: findCapabilitySkill(skills, DESKTOP_SKILL_ID),
          browserSkills: findCapabilitySkills(skills, BROWSER_SKILL_IDS),
        };
        let healed = false;
        for (const groupId of ["writing-code", "desktop-automation", "browser-automation"] as CapabilityGroupId[]) {
          const plan = planAction(snapshot, groupId, true);
          if (isEmptyAction(plan)) continue;
          await applyAction(plan, bag.groupIpc);
          healed = true;
        }
        if (!healed) return;
        bag.setPonytailOn(await window.codex.ponytailModeGet?.().catch(() => "full") !== "off");
        bag.setMcpOverrides(await window.codex.readMcpServerOverrides().catch(() => ({}) as Record<string, boolean>));
        bag.setLocalSkills(await window.codex.listLocalSkills());
        await bag.refreshSettingsResources();
      } catch { /* 自愈失败不阻塞启动 */ }
    })();
  }, []);

  /**
   * 其他 tab（技能 / MCP / 插件 / 钩子）里点击关闭受总闸托管子项的拦截器：
   * 返回 true 表示已拦截（提示去常规页关总闸），false 表示放行。
   */
  function guardGroupOff(
    member: Parameters<typeof guardOffOwner>[1],
    label: string,
    next: boolean,
  ): boolean {
    if (next) return false; // 开启总是允许（不会破坏联动）
    const owner = guardOffOwner(bag.capabilitySnapshot, member);
    if (!owner) return false;
    bag.setNotice(`「${label}」由「${GROUP_LABELS[owner]}」开关控制，请在「控制台」页关闭${GROUP_LABELS[owner]}（否则会被总闸重新拉起）`);
    return true;
  }
bag.guardGroupOff = guardGroupOff as typeof bag.guardGroupOff;

  /** 常规页总闸行的「部分启用」提示：列出还没跟着开关走的子项，点开关可一次性对齐。 */
  const capabilityHint = (groupId: CapabilityGroupId): string | null => {
    const hint = describePartial(bag.capabilitySnapshot, groupId, MEMBER_LABELS);
    return hint ? `部分启用（${hint.onCount}/${hint.totalCount}）：${hint.pendingLabels.join("、")} 未同步，点右侧开关可一次性对齐` : null;
  };
bag.capabilityHint = capabilityHint as typeof bag.capabilityHint;

  async function batchSetPluginEnabled(plugins: any[], enabled: boolean) {
    const ids = plugins.map((plugin) => String(plugin.id ?? "")).filter(Boolean);
    if (!ids.length) { bag.setNotice(enabled ? "没有可启用的插件" : "没有可停用的插件"); return; }
    bag.setPluginBatchBusy(enabled ? "enable" : "disable");
    try {
      const result = await window.codex.setPluginEnabled({ pluginIds: ids, enabled });
      bag.setPluginChecked([]);
      await bag.refreshSettingsResources();
      if (result.failures?.length) bag.setNotice(`${result.changed} 个插件已${enabled ? "启用" : "停用"}，${result.failures.length} 个失败：${result.failures.join("；")}`);
      else bag.setNotice(`已${enabled ? "启用" : "停用"} ${result.changed} 个插件`);
    } catch (error: any) { bag.setNotice(`批量${enabled ? "启用" : "停用"}失败：${error.message}`); }
    finally { bag.setPluginBatchBusy(null); }
  }
bag.batchSetPluginEnabled = batchSetPluginEnabled as typeof bag.batchSetPluginEnabled;

  /** 技能批量启停：只作用于可移除的本机技能，内置技能由引擎提供、不参与 */
  async function batchSetSkillEnabled(folders: string[], enabled: boolean) {
    if (!folders.length) { bag.setNotice(enabled ? "没有可启用的技能" : "没有可停用的技能"); return; }
    // 批量停用同样要过滤掉受总闸托管的技能，否则会被总闸拉回，批量结果看着成功实际没生效
    const targets = folders.filter((folder) => !bag.guardGroupOff({ kind: "skill", folder }, `技能「${folder}」`, enabled));
    if (!targets.length) return;
    bag.setSkillBatchBusy(enabled ? "enable" : "disable");
    try {
      const result = await window.codex.setEnabledSkillBatch({ folders: targets, enabled });
      bag.setSkillChecked([]);
      bag.setLocalSkills(await window.codex.listLocalSkills());
      await bag.refreshSettingsResources();
      if (result.failures?.length) bag.setNotice(`${result.changed} 个技能已${enabled ? "启用" : "停用"}，${result.failures.length} 个失败：${result.failures.join("；")}`);
      else bag.setNotice(`已${enabled ? "启用" : "停用"} ${result.changed} 个技能`);
    } catch (error: any) { bag.setNotice(`批量${enabled ? "启用" : "停用"}失败：${error.message}`); }
    finally { bag.setSkillBatchBusy(null); }
  }
bag.batchSetSkillEnabled = batchSetSkillEnabled as typeof bag.batchSetSkillEnabled;

  useEffect(() => {
    const off = window.codex.onEvent((event) => {
      if (event.kind === "status") { if (handleEventRouter1(bag, event)) return; }
      if (event.kind === "request" && event.id !== undefined && event.method) { if (handleEventRouter2(bag, event)) return; }
      if (event.kind !== "notification") return;
      const params = event.params ?? {};
      // ── 跨会话生命周期事件：即使属于后台会话也要先处理，用于维护运行指示器 ──
      // 侧边栏转圈必须跟着「真正在运行的会话」，不能因为切到别的会话就跟着跑过去。
      // 这些事件不能被下面的 threadId 过滤挡掉，否则切走后后台会话的
      // turn/started · turn/completed 收不到 → activeTurnId 残留、侧边栏状态不更新。
      if (params.threadId) { if (handleEventRouter3(bag, event, params)) return; }
      if (params.threadId && params.threadId !== bag.threadRef.current?.id) return;
      const method = event.method ?? "";
      // 钉顶模式不在首条 delta 就切回底部跟随（旧做法让「钉在视口上边框下方两行」从未
      // 真正出现就被贴底滚动冲掉，表现为「每次新消息位置都不一样」）：视口由钉顶循环接管，
      // 下方内容长满视口后由循环自然交还贴底（衔接无跳变）。stick 本就为 true 时保持即可。
      if (threadStreamMethods.has(method)) { if (handleEventRouter4(bag, params, method)) return; }
      if (bag.reviewTurnRef.current && params.turnId === bag.reviewTurnRef.current) {
        if (method === "item/agentMessage/delta") bag.setReviewReport((current) => current + (params.delta ?? ""));
        else if (method === "item/completed" && params.item?.type === "agentMessage") bag.setReviewReport(params.item.text ?? "");
        else if (method === "turn/completed") {
          bag.setReviewBusy(false);
          bag.reviewTurnRef.current = null;
        }
      }
      if (method === "item/started" && params.item?.type === "reasoning") {
        reasoningStart.set(String(params.item.id ?? params.itemId ?? ""), Date.now());
      } else if (method === "item/completed" && params.item?.type === "reasoning") {
        // 只补记开始时间，不在这里落 reasoningDuration。
        // 深度思考很长时引擎/中转会偶发「提前 completed + 后续继续发 delta」
        // （日志实证 codex_core 报 ReasoningSummaryDelta without active item），
        // 若此时落 duration，reasoningActive 判定（要求 !reasoningDuration.has）
        // 会立刻把运行状态打停，但思考其实还在出字（用户实测：思考跑很久后
        // 运行状态莫名断）。duration 统一在 turn/completed 时结算（见下）。
        const key = String(params.item.id ?? params.itemId ?? "");
        if (!reasoningStart.has(key)) reasoningStart.set(key, Date.now());
      }
      // ⛔ 判定走 isCompactionItem（唯一口径，大小写不敏感）——引擎发/落盘的是 PascalCase
      //    「ContextCompaction」，早先各处硬写 camelCase 让整条压缩链静默不命中（09-26 rollout 取证）。
      //    ② attachCompactionItem：压缩 item 的 turnId 常指向宿主**不知道**的引擎内部回合
      //    ⇒ mergeItem 丢弃它 ⇒ thread 里没有 item ⇒ 渲染层无法归位（线只剩尾部 toast 兜底，
      //    用户三次看到「线一直在下面」）。兜底把它挂到最后一条已知回合（= 压缩发生的历史点）。
      if (method === "item/started" && isCompactionItem(params.item)) {
        bag.compactPendingRef.current.add(String(params.threadId ?? bag.threadRef.current?.id ?? ""));
        bag.setCompactEventState("running");
        bag.pruneSupersededCompactions(String(params.item?.id ?? ""));
        bag.attachCompactionItem(params.item, String(params.turnId ?? ""));
        // ⛔ 挂载后再收敛一次（09-26 用户截图「两条压缩线」）：挂载兜底是「找不到同 id 就追加」，
        //    引擎两阶段的 id/形态不一致时会追加出第二条 ⇒ 必须收尾 prune 成最新一条。
        bag.pruneSupersededCompactions(String(params.item?.id ?? ""));
      } else if (method === "item/completed" && isCompactionItem(params.item)) {
        const tid0 = String(params.threadId ?? bag.threadRef.current?.id ?? "");
        const itemId0 = String(params.item?.id ?? "");
        bag.compactPendingRef.current.delete(tid0);
        // ⛔ 成功提示只在「再无进行中的压缩 item」时发（09-26 用户截图：分隔线还在转圈、
        //    toast 已报「压缩成功」）——同会话还有别的压缩 item 在跑（自动+手动叠加）时，
        //    这条 completed 只代表其中一个完成，成功要等最后一个（排除刚完成的这条再查）。
        const stillCompacting = (() => {
          const turns = bag.threadRef.current?.turns ?? [];
          for (const t of turns) {
            for (const it of (t.items ?? []) as any[]) {
              if (isCompactionItem(it) && (it?.status === "inProgress" || it?.status === "running") && String(it?.id ?? "") !== itemId0) return true;
            }
          }
          return false;
        })();
        if (!stillCompacting) bag.setCompactEventState("success");
        bag.pruneSupersededCompactions(String(params.item?.id ?? ""));
        bag.attachCompactionItem(params.item, String(params.turnId ?? ""));
        // ⛔ 挂载后再收敛一次（09-26 用户截图「两条压缩线」）：挂载兜底是「找不到同 id 就追加」，
        //    引擎两阶段的 id/形态不一致时会追加出第二条 ⇒ 必须收尾 prune 成最新一条。
        bag.pruneSupersededCompactions(String(params.item?.id ?? ""));
        bag.settleAfterCompaction(tid0);
      }
      if (method === "turn/plan/updated") {
        bag.setPlanSteps((params.plan ?? []).map((step: any) => ({ step: step.step ?? "", status: step.status ?? "pending" })));
      } else if (method === "thread/goal/updated" || method === "thread/goal/set") {
        if (params.goal?.objective) {
          bag.setGoalText(params.goal.objective);
          bag.setGoalStatus(params.goal.status ?? "active");
        } else {
          bag.setGoalText("");
          bag.setGoalStatus(null);
        }
      } else if (method === "turn/completed") { if (handleEventRouter5(bag, params)) return; }
      if (method === "turn/started") { if (handleEventRouter6(bag, params)) return; } else if (method === "turn/completed") { if (handleEventRouter7(bag, params)) return; } else if (method === "item/started" || method === "item/completed") {
        // 不在这里清空 optimisticInput：清除时机交给渲染端的文本去重，
        // 否则 item/started 与 setThread 的批处理时序差异会让用户消息瞬间消失。
      } else if (method === "hook/started" || method === "hook/completed") {
        bag.addHookEvent(method === "hook/started", String(params.run?.name ?? params.run?.id ?? "Hook"));
      } else if (event.method === "item/autoApprovalReview/started") {
        bag.showToast("正在审查命令权限", "Codex 正在进行自动安全审查");
      } else if (event.method === "item/autoApprovalReview/completed") {
        bag.showToast("命令权限审查完成", params.decisionSource ?? "完成");
      } else if (event.method === "autoApprovalReview/strictReviewRequired") {
        bag.showToast("需要严格审批", "后续命令将逐项请求确认");
      } else if (event.method === "turn/diff/updated") {
        bag.setDiff(params.diff ?? "");
      } else if (event.method === "thread/tokenUsage/updated") {
        /* ⛔ 用量按**会话**归属（09-25）：只有当前正在看的会话才进上下文环；后台会话
           （团队成员 / 被委派的子会话）的推送只存进它自己那一份快照，不污染当前的环
           —— 否则「一边跑着成员会话、一边看主会话」时环里会是别人的数字。 */
        const usageThreadId = String(params.threadId ?? bag.threadRef.current?.id ?? "");
        if (usageThreadId) {
          const normalizedUsage = bag.normalizeTokenUsage(params.tokenUsage, usageThreadId);
          // 落盘：切供应商会重启应用，不落盘则重启后进度"归零"（用户 09-25 报障）
          bag.persistTokenUsageSnapshot(usageThreadId, normalizedUsage);
          if (usageThreadId === String(bag.threadRef.current?.id ?? "")) {
            bag.tokenUsageRef.current = normalizedUsage;
            bag.setTokenUsage(normalizedUsage);
          }
        }
      } else if (event.method === "error") { if (handleEventRouter8(bag, params)) return; } else if (event.method === "serverRequest/resolved") {
        bag.setPending((current) => current.filter((entry) => entry.id !== params.requestId));
      } else if (method === "thread/name/updated") {
        const nextName = params.threadName ?? null;
        bag.setThreads((current) => current.map((entry) => entry.id === params.threadId ? { ...entry, name: nextName } : entry));
        const cached = bag.threadCacheRef.current.get(params.threadId);
        if (cached) bag.threadCacheRef.current.set(params.threadId, { ...cached, name: nextName });
        bag.setThread((current) => {
          if (!current || current.id !== params.threadId) return current;
          const next = { ...current, name: nextName };
          bag.threadRef.current = next;
          return next;
        });
      } else if (method === "thread/status/changed") {
        bag.setThreads((current) => current.map((entry) => entry.id === params.threadId ? { ...entry, status: params.status } : entry));
      } else if (event.method === "thread/settings/updated") { if (handleEventRouter9(bag, params)) return; } else if (event.method === "thread/queue/changed") {
        void bag.refreshQueue(params.threadId);
        } else if (event.method === "thread/archived" || event.method === "thread/deleted") {
          bag.setThreads((current) => current.filter((entry) => entry.id !== params.threadId));
          bag.threadCacheRef.current.delete(params.threadId);
          // ⛔ 该会话被归档/删除 → 它的重试链与提示**一并作废**：否则退避到点后会对着一个
          //   已归档/不存在的会话重发（引擎报 not found），属于无意义的跨会话串扰。
          bag.resetSessionRetryState(params.threadId);
          if (bag.threadRef.current?.id === params.threadId) {
            // 引擎侧归档/删除当前会话同样走完整复位（漏 sending 会让发送按钮卡成「停止」）
            bag.startNewThread();
          }
      } else if (event.method === "model/verification") {
        const verificationText = (params.verifications ?? []).map((entry: any) => entry.message ?? JSON.stringify(entry)).join("\n") || "完成";
        // 模型元数据回退属已知无害噪音（自定义模型名不在引擎内置表），不弹「模型校验」卡
        if (/unknown model|fallback (model )?metadata|model metadata.*not found/i.test(verificationText)) return;
        bag.showToast("模型校验", translateEngineNotice(verificationText));
      } else if (event.method === "model/safetyBuffering/updated" && params.showBufferingUi) {
        bag.showToast("模型安全缓冲", params.reasons?.join("；") || "正在检查模型输出");
      } else if (event.method === "thread/compacted") {
        bag.compactPendingRef.current.delete(String(params.threadId ?? bag.threadRef.current?.id ?? ""));
        // 压缩后上下文骤降：清掉 total 差值快照，让引擎随后的 usage 推送不被
        // 「input/cached 单调递增」的差值推导误判（压缩后 input 回落是正常的），
        // ContextRing 才能真实反映压缩后的占用。下一轮对话完成时用量自然刷新。
        {
          const tid = String(params.threadId ?? bag.threadRef.current?.id ?? "");
          if (tid) { bag.tokenUsageTotalsRef.current.delete(tid); bag.derivedTokenUsageRef.current.delete(tid); }
        }
        // 引擎产出的摘要文本（09-26「摘要接力」用：宿主真压缩拿它做新会话的历史种子）。
        // 字段名按引擎实际形态兜底取值（payload.message / summary / text 任一）。
        bag.compactedSummaryRef.current = String(params.message ?? params.summary ?? params.text ?? "");
        bag.setCompactEventState("success");
        // ⛔ 分隔线停转（09-26 用户截图：toast 已报成功、分隔线还在转圈）：thread/compacted
        //    是权威完成信号，引擎侧对应 item 的 completed 可能迟到/缺失 —— 本地把所有还挂着
        //    的 inProgress 压缩 item 落成 completed，分隔线立即停转（不依赖引擎补发）。
        {
          const tid2 = String(params.threadId ?? bag.threadRef.current?.id ?? "");
          if (tid2 && tid2 === bag.threadRef.current?.id) {
            bag.setThread((current) => {
              if (!current) return current;
              let changed = false;
              const turns = (current.turns ?? []).map((t) => ({
                ...t,
                items: (t.items ?? []).map((it: any) => {
                  if (it?.type === "contextCompaction" && it?.status === "inProgress") { changed = true; return { ...it, status: "completed" }; }
                  return it;
                }),
              }));
              return changed ? { ...current, turns } : current;
            });
          }
        }
        // ⛔ 压缩完成必须结算运行态（09-26 用户截图「压缩后『正在生成回复』一直挂着」）：
        //    引擎把压缩跑成一个回合时 turn/started 会点亮 running/sending/activeTurnId，
        //    但压缩的完成走 thread/compacted（不保证有 turn/completed）⇒ 没人熄灭，
        //    状态条与停止键永久亮着。settleAfterCompaction 内部有「真回合还在跑就不动」守卫。
        bag.settleAfterCompaction(String(params.threadId ?? bag.threadRef.current?.id ?? ""));
      } else if (event.method === "model/rerouted") {
        bag.showToast("模型已切换", `${params.fromModel} → ${params.toModel}`);
      } else if (["warning", "guardianWarning", "deprecationNotice", "configWarning"].includes(event.method ?? "")) {
        const text = String(params.message ?? params.details ?? "");
        // 已知无害的技术性提示不弹卡（模型元数据回退、压缩英文提示）：
        // - "Unknown model X is used. This will use fallback model metadata."
        //   "Model metadata for X not found. Defaulting to fallback metadata..."
        //   自定义模型名不在引擎内置元数据表时触发，属正常噪音（上下文窗口已在
        //   custom-model.json 里配置，引擎会用用户给的 contextWindow，不影响使用）。
        // - "Heads up: Long threads…"（压缩英文提示）已在上方「上下文已压缩」卡片中翻译。
        if (/unknown model|fallback (model )?metadata|model metadata.*not found/i.test(text)) return;
        // 引擎协议迁移提示（如 Full-history hydration deprecated for paginated threads…）
        // 面向的是宿主开发者：harness 已做 thread/turns/list 分页兜底，弹给用户只会被当成「出 BUG 了」
        if (event.method === "deprecationNotice" && /hydrat|deprecat|use `excludeTurns/i.test(text + " " + String(params.summary ?? ""))) return;
        if (!/long threads|multiple compactions/i.test(text)) bag.showToast(event.method === "configWarning" ? params.summary ?? "配置警告" : "Codex 提示", translateEngineNotice(text) || JSON.stringify(params));
      }
    });
    const offChannel = window.codex.onChannelBotEvent((event) => {
      bag.setChannelBot((current) => current ? { ...current, ...event.status, logs: [...(current.logs ?? []), { at: event.at, level: event.level, message: event.message }].slice(-20) } : current);
      if (event.level === "error") bag.setChannelStatus(event.message);
      // 网关状态变化（微信/Telegram 连接成功）时刷新圆点
      if (/微信|Telegram/.test(event.message)) void window.codex.channelsStatus?.().then(bag.setChannelOnline).catch(() => undefined);
    });
    const offHarness = window.codex.onHarnessEvent((event) => {
      if (event.type === "delegates-changed") {
        // 调度登记变化（发起 / 结束 / 归档）→ 刷新登记表 + 侧栏列表。
        // ⛔ 必须走 onHarnessEvent：主进程 broadcastHarnessEvent 的 payload 是**裸的** `{ type }`，
        //    不是包了 channel 的 MessageEvent —— 09-15 验收实测踩过这个坑（badge 一直不出现）。
        void bag.refreshDelegateRecords();
        void bag.refreshThreads();
      }
      if (event.type === "delegate-run") {
        // 调度头像轨（09-16）：started 点亮头像 + 自动弹工作内容；delta 流式追加；finished 摘掉头像。
        const payload: any = event;
        if (payload.phase === "started" && payload.record?.threadId) {
          const r = payload.record;
          bag.setDelegateLiveRuns((prev) => ({
            ...prev,
            [r.threadId]: {
              threadId: String(r.threadId), originThreadId: String(r.originThreadId ?? ""), kind: r.kind,
              name: String(r.name ?? ""), status: "running", output: String(r.output ?? ""), startedAt: Number(r.startedAt ?? Date.now()),
            },
          }));
          bag.setDelegatedPopupId(String(r.threadId)); // 与专家团一致：一开始干活就自动弹出工作内容
        } else if (payload.phase === "delta" && payload.threadId) {
          bag.setDelegateLiveRuns((prev) => {
            const current = prev[String(payload.threadId)];
            if (!current) return prev;
            return { ...prev, [String(payload.threadId)]: { ...current, output: (current.output ?? "") + String(payload.text ?? "") } };
          });
        } else if (payload.phase === "finished" && payload.threadId) {
          const finishedId = String(payload.threadId);
          bag.setDelegateLiveRuns((prev) => {
            const current = prev[finishedId];
            if (!current) return prev;
            // 头像**不立刻消失**（用户 09-16：「调度完头像停留 20 秒，方便用户查看内容」）：
            // 先切成完成态（呼吸环停、头像回正），20 秒后再从轨上摘掉。
            return {
              ...prev,
              [finishedId]: { ...current, status: payload.status === "failed" ? "failed" : "done", output: String(payload.output ?? current.output ?? ""), error: payload.error, endedAt: Date.now() },
            };
          });
          if (bag.delegateRailTimersRef.current.has(finishedId)) clearTimeout(bag.delegateRailTimersRef.current.get(finishedId)!);
          bag.delegateRailTimersRef.current.set(finishedId, setTimeout(() => {
            bag.delegateRailTimersRef.current.delete(finishedId);
            bag.setDelegateLiveRuns((prev) => {
              if (!prev[finishedId]) return prev;
              const next = { ...prev };
              delete next[finishedId];
              return next;
            });
            bag.setDelegatedPopupId((id) => (id === finishedId ? "" : id));
          }, DELEGATE_RAIL_LINGER_MS));
        }
      }
      if (event.type === "popout-return") {
        // 弹窗「返回主应用」：主窗口收到后跳到弹窗里的那个会话（弹窗已由主进程关闭）
        const tid = String((event as any).threadId ?? "");
        if (tid) {
          bag.setPopoutThreadId(null);
          bag.popoutThreadIdRef.current = null;
          if (bag.threadsRef.current.some((entry: any) => entry.id === tid)) void bag.openThread(tid);
          else void window.codex.request("thread/list", { limit: 80, sortKey: "updated_at", sortDirection: "desc", archived: false }).then((r) => {
            if ((r.data ?? []).some((entry: any) => entry.id === tid)) void bag.openThread(tid);
          }).catch(() => undefined);
        }
      }
      if (event.type === "popout-closed") {
        // 弹窗被关闭（点 X / 返回主应用 / 主窗口联动）：被隐藏的会话回到侧栏。
        // 全量重拉（而非只删单条）：弹窗异常退出时主进程已移除、渲染层状态可能残留，
        // 重拉保证收敛到主进程的真实弹窗列表。
        bag.refreshPoppedOut();
      }
      if (event.type === "thread-runtime") {
        // 另一个窗口改了某个会话的模型/档位/权限（主进程广播）：写镜像；若正是本窗口打开的
        // 会话，界面也要跟着变——否则本窗口会用旧值把对方的改动覆盖回去（丢更新）。
        const tid = String((event as any).threadId ?? "");
        if (tid) bag.admitThreadRuntime(tid, (event as any).runtime, { fromRemote: true });
        // 调度独占锁可能刚被别的窗口/别的会话挪走 → 本窗口的「谁占用」提示要跟着变，
        // 否则会显示过期占用者（用户看到「被 A 占用」而 A 其实已经关了）。
        if ((event as any).runtime?.dispatch) void bag.refreshDispatchOwner();
      }
      if (event.type === "team-run") {
        // 专家团成员委托的运行状态（主进程广播给所有窗口）：头像轨的亮灭流转、成员工作弹窗的
        // 实时内容、历史记录都基于这一份数据。popout 独立窗口收到的与主窗口完全一致
        // ——不需要每个窗口各自维护，也不会因为窗口自己的 React 状态滞后而错位。
        const phase = String((event as any).phase ?? "");
        const run = (event as any).run as TeamMemberRunRecord | undefined;
        if (phase === "started" && run?.runId) {
          bag.setTeamRuns((prev) => ({ ...prev, [run.runId]: { ...run, output: run.output ?? "" } }));
          // 侧栏聚簇索引同步：leadThreadId → teamId（run 里权威携带，不用等 teamThreadsMap 重拉）
          if (run.leadThreadId && run.teamId) bag.setTeamThreadsIndex((prev) => (prev[run.leadThreadId] === run.teamId ? prev : { ...prev, [run.leadThreadId]: run.teamId }));
          // 成员线程 id 一并登记（新委托产生的成员会话立即按成员层级渲染）
          const memberTid = String(run.memberThreadId ?? "");
          if (memberTid) bag.setTeamMemberThreadIds((prev) => (prev.has(memberTid) ? prev : new Set(prev).add(memberTid)));
          bag.setTeamPopupRunId(run.runId); // 成员开始干活 → 自动打开它的工作弹窗
        } else if (phase === "delta") {
          const runId = String((event as any).runId ?? "");
          const chunk = String((event as any).text ?? "");
          if (runId && chunk) {
            // 增量高频（每字一条）→ rAF 合帧再 setState，避免流式把渲染打爆
            bag.teamDeltaRef.current.set(runId, `${bag.teamDeltaRef.current.get(runId) ?? ""}${chunk}`);
            if (bag.teamFlushRef.current === null) {
              bag.teamFlushRef.current = requestAnimationFrame(() => {
                bag.teamFlushRef.current = null;
                const buffer = bag.teamDeltaRef.current;
                bag.teamDeltaRef.current = new Map();
                bag.setTeamRuns((prev) => {
                  const next = { ...prev };
                  for (const [id, text] of buffer) {
                    const entry = next[id];
                    if (!entry) continue;
                    next[id] = { ...entry, output: `${entry.output ?? ""}${text}` };
                  }
                  return next;
                });
              });
            }
          }
        } else if (phase === "finished" && run?.runId) {
          bag.teamDeltaRef.current.delete(run.runId);
          bag.setTeamRuns((prev) => ({ ...prev, [run.runId]: run }));
        }
      }
      if (event.type === "scheduler") bag.showToast("定时任务", event.message);
      if (event.type === "memory") bag.showToast("记忆", event.message);
      if (event.type === "skill-install") {
        const positions: Record<string, number> = { download: 1, extract: 2, audit: 3, install: 4, register: 5, engine: 6, verify: 6, complete: 7, pending: 7 };
        bag.setSkillInstall((current) => {
          if (!current || current.skill.id !== event.skillId) return current;
          return { ...current, current: Math.max(current.current, positions[event.stage] ?? current.current), engineRegistered: event.stage === "complete" ? true : current.engineRegistered, engineCheckMessage: ["complete", "pending"].includes(event.stage) ? event.message : current.engineCheckMessage };
        });
      }
      if (event.type === "provider-activated") {
        // 供应商→中转站反向联动：生效供应商变成非 relay 时，清掉中转站「当前生效」标记，
        // 余额徽标/置顶订阅卡即时退场（此前只靠 activeProvider 逐处比对，relay-active 会残留）。
        // relayActivate 自身最后一步才写 relay-active，本分支先清后写也会收敛到正确终态。
        const activated = String((event as any).provider ?? "");
        const relay = readRelayActive();
        if (activated && relay && relay.provider !== activated) {
          writeRelayActive(null);
          bag.showToast("已切换到其他供应商", `中转站「${relay.label}」退出当前生效；重新选用套餐或密钥即可再启用`);
        }
      }
      if (event.type === "skill-remove") {
        const positions: Record<string, number> = { prepare: 1, delete: 2, registry: 3, engine: 4, verify: 5, complete: 6, pending: 6 };
        bag.setSkillRemove((current) => {
          if (!current || current.folder !== event.skillId) return current;
          return { ...current, current: Math.max(current.current, positions[event.stage] ?? current.current), engineRemoved: event.stage === "complete" ? true : current.engineRemoved, engineCheckMessage: ["complete", "pending"].includes(event.stage) ? event.message : current.engineCheckMessage };
        });
      }
      if (event.type === "plugin-install") {
        const positions: Record<string, number> = { resolve: 1, download: 2, install: 3, register: 4, engine: 5, verify: 6, complete: 7, pending: 7 };
        bag.setPluginInstall((current) => {
          if (!current || current.plugin.slug !== event.pluginId) return current;
          return { ...current, current: Math.max(current.current, positions[event.stage] ?? current.current), engineRegistered: event.stage === "complete" ? true : current.engineRegistered, engineCheckMessage: ["complete", "pending"].includes(event.stage) ? event.message : current.engineCheckMessage };
        });
      }
    });

    void window.codex.request("thread/list", { limit: 80, sortKey: "updated_at", sortDirection: "desc", archived: false })
      .then((threadResult) => {
        // 同样要贴本地覆盖（否则这条路径一跑，用户在别处改过的项目地址/名字就被引擎旧值顶回去）
        const list = (threadResult.data ?? []).map((entry: Thread) => bag.withNameOverride(bag.withCwdOverride(entry)));
        bag.setThreads(list);
        bag.threadsRef.current = list;
        bag.setServerStatus("ready");
        // ⛔ 独立会话弹窗：本窗口锁定 popout 会话（不读 last-thread、不走全局恢复）。
        // 弹窗启动即打开指定会话，侧栏仍完整可用（可再切到其他会话——弹窗是完整界面）。
        const lastId = (() => { try { return localStorage.getItem("last-thread"); } catch { return null; } })();
        const targetId = bag.popoutThreadIdRef.current || lastId;
        if (targetId && list.some((entry: any) => entry.id === targetId)) void bag.openThread(targetId);
      })
      .catch(() => bag.setServerStatus("error"))
      .finally(() => bag.setLoading(false));
    return () => { off(); offChannel(); offHarness(); };
  }, []);
  return { changePlugin, setPluginEnabled, ponytailPluginEntry, ponytailPluginOn, ponytailSkillsSnap, desktopSkillSnap, browserSkillsSnap, nuphusMcpOn, capabilitySnapshot, groupBusy, setGroupBusy, groupIpc, applyGroup, bootHealRef, guardGroupOff, capabilityHint, batchSetPluginEnabled, batchSetSkillEnabled };
}
