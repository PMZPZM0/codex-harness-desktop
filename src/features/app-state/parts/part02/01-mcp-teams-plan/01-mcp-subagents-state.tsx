/**
 * usePart02a1 —— usePart02a 按序切分出的第 1 段（纯搬迁、零改写）。
 * 域：MCP 覆盖与工具权限 · 子代理状态 — 专家团映射/角色记忆/待导入
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import type { SearchPreviewTarget } from "../../../../../components/IndexLibrary";
import type { Bag } from "../../bag-types";

export function usePart02a1(bag: Bag) {
  // app-server MCP 状态卡：引擎直管服务器的启停覆盖表 + 勾选/忙碌态。
  // 覆盖表只记录被显式改过的项，没记过的一律视为启用。
  const [mcpOverrides, setMcpOverrides] = useState<Record<string, boolean>>({});
bag.mcpOverrides = mcpOverrides as typeof bag.mcpOverrides; bag.setMcpOverrides = setMcpOverrides as typeof bag.setMcpOverrides;

  // 各 MCP 服务器的按工具权限档位（deny/ask/allow），复刻 WorkBuddy 工具级权限模型
  const [mcpToolPermissions, setMcpToolPermissions] = useState<Record<string, Record<string, "deny" | "ask" | "allow">>>({});
bag.mcpToolPermissions = mcpToolPermissions as typeof bag.mcpToolPermissions; bag.setMcpToolPermissions = setMcpToolPermissions as typeof bag.setMcpToolPermissions;

  const [mcpServerChecked, setMcpServerChecked] = useState<string[]>([]);
bag.mcpServerChecked = mcpServerChecked as typeof bag.mcpServerChecked; bag.setMcpServerChecked = setMcpServerChecked as typeof bag.setMcpServerChecked;

  const [mcpServerStatusBusy, setMcpServerStatusBusy] = useState<string | null>(null);
bag.mcpServerStatusBusy = mcpServerStatusBusy as typeof bag.mcpServerStatusBusy; bag.setMcpServerStatusBusy = setMcpServerStatusBusy as typeof bag.setMcpServerStatusBusy;

  const [mcpServerBatchBusy, setMcpServerBatchBusy] = useState<"enable" | "disable" | null>(null);
bag.mcpServerBatchBusy = mcpServerBatchBusy as typeof bag.mcpServerBatchBusy; bag.setMcpServerBatchBusy = setMcpServerBatchBusy as typeof bag.setMcpServerBatchBusy;

  const [mcpServerSearch, setMcpServerSearch] = useState("");
bag.mcpServerSearch = mcpServerSearch as typeof bag.mcpServerSearch; bag.setMcpServerSearch = setMcpServerSearch as typeof bag.setMcpServerSearch;

  const [subAgents, setSubAgents] = useState<SubAgentEntry[]>([]);
bag.subAgents = subAgents as typeof bag.subAgents; bag.setSubAgents = setSubAgents as typeof bag.setSubAgents;

  const [subAgentDraft, setSubAgentDraft] = useState<SubAgentEntry | null>(null);
bag.subAgentDraft = subAgentDraft as typeof bag.subAgentDraft; bag.setSubAgentDraft = setSubAgentDraft as typeof bag.setSubAgentDraft;

  const [subAgentEditorOpen, setSubAgentEditorOpen] = useState(false);
bag.subAgentEditorOpen = subAgentEditorOpen as typeof bag.subAgentEditorOpen; bag.setSubAgentEditorOpen = setSubAgentEditorOpen as typeof bag.setSubAgentEditorOpen;

  const [subAgentRunning, setSubAgentRunning] = useState<string | null>(null);
bag.subAgentRunning = subAgentRunning as typeof bag.subAgentRunning; bag.setSubAgentRunning = setSubAgentRunning as typeof bag.setSubAgentRunning;

  // RPA：正在执行的配方 id + agent 向用户的提问卡（resolve 回调挂在 state 里，按钮点击后放行 tool call）
  // agent_ask 不再全局弹窗：挂在所属会话上，贴输入框上方展示；用户不在该会话时只发通知，切回再显示
  const [rpaRunning, setRpaRunning] = useState<string | null>(null);
bag.rpaRunning = rpaRunning as typeof bag.rpaRunning; bag.setRpaRunning = setRpaRunning as typeof bag.setRpaRunning;

  const [agentAsk, setAgentAsk] = useState<{ threadId: string; question: string; options: string[]; recommended: string | null; allowFree: boolean; resolve: (answer: string) => void } | null>(null);
bag.agentAsk = agentAsk as typeof bag.agentAsk; bag.setAgentAsk = setAgentAsk as typeof bag.setAgentAsk;

  const [rpaRecipes, setRpaRecipes] = useState<any[]>([]);
bag.rpaRecipes = rpaRecipes as typeof bag.rpaRecipes; bag.setRpaRecipes = setRpaRecipes as typeof bag.setRpaRecipes;

  const [taskList, setTaskList] = useState<any[]>([]);
bag.taskList = taskList as typeof bag.taskList; bag.setTaskList = setTaskList as typeof bag.setTaskList;

  // 应用内输入/确认弹窗：避免 Electron 原生 prompt 不可用，以及系统 confirm 抢走窗口焦点。
  // threadPermPushAt：每会话最近一次权限推送时间（settings/updated 旧值回推的忽略窗口依据）
  const threadPermPushAtRef = useRef<Map<string, number>>(new Map());
bag.threadPermPushAtRef = threadPermPushAtRef as typeof bag.threadPermPushAtRef;

  const appPromptInputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
bag.appPromptInputRef = appPromptInputRef as typeof bag.appPromptInputRef;

  const [appConfirm, setAppConfirm] = useState<{ title: string; text: string; confirmLabel: string; resolve: (confirmed: boolean) => void } | null>(null);
bag.appConfirm = appConfirm as typeof bag.appConfirm; bag.setAppConfirm = setAppConfirm as typeof bag.setAppConfirm;

  const [appPrompt, setAppPrompt] = useState<{ title: string; value: string; multiline?: boolean; resolve: (text: string | null) => void } | null>(null);
bag.appPrompt = appPrompt as typeof bag.appPrompt; bag.setAppPrompt = setAppPrompt as typeof bag.setAppPrompt;

  // 记忆卡片全文预览：卡片本身只显示 3 行截断，点开看完整内容
  const [memoryPreview, setMemoryPreview] = useState<any>(null);
bag.memoryPreview = memoryPreview as typeof bag.memoryPreview; bag.setMemoryPreview = setMemoryPreview as typeof bag.setMemoryPreview;

  // 全局搜索命中预览（记忆中心→全局搜索）：会话全文由主进程读 rollout 原档提供
  const [searchPreview, setSearchPreview] = useState<SearchPreviewTarget | null>(null);
bag.searchPreview = searchPreview as typeof bag.searchPreview; bag.setSearchPreview = setSearchPreview as typeof bag.setSearchPreview;

  // 记忆中心大弹窗：设置页「记忆」只做总览，条目浏览/常驻记忆编辑/存储切换都在这里完成
  const [memoryCenterOpen, setMemoryCenterOpen] = useState(false);
bag.memoryCenterOpen = memoryCenterOpen as typeof bag.memoryCenterOpen; bag.setMemoryCenterOpen = setMemoryCenterOpen as typeof bag.setMemoryCenterOpen;

  const [memoryCenterTab, setMemoryCenterTab] = useState<"library" | "search" | "layers" | "storage">("library");
bag.memoryCenterTab = memoryCenterTab as typeof bag.memoryCenterTab; bag.setMemoryCenterTab = setMemoryCenterTab as typeof bag.setMemoryCenterTab;

  const [memoryProjectWorkspace, setMemoryProjectWorkspace] = useState(() => bag.workspace || "__all__");
bag.memoryProjectWorkspace = memoryProjectWorkspace as typeof bag.memoryProjectWorkspace; bag.setMemoryProjectWorkspace = setMemoryProjectWorkspace as typeof bag.setMemoryProjectWorkspace;

  const [memoryProjectEnabled, setMemoryProjectEnabled] = useState(false);
bag.memoryProjectEnabled = memoryProjectEnabled as typeof bag.memoryProjectEnabled; bag.setMemoryProjectEnabled = setMemoryProjectEnabled as typeof bag.setMemoryProjectEnabled;

  const [memoryProjectMenuOpen, setMemoryProjectMenuOpen] = useState(false);
bag.memoryProjectMenuOpen = memoryProjectMenuOpen as typeof bag.memoryProjectMenuOpen; bag.setMemoryProjectMenuOpen = setMemoryProjectMenuOpen as typeof bag.setMemoryProjectMenuOpen;

  const memoryProjectPickerRef = useRef<HTMLDivElement>(null);
bag.memoryProjectPickerRef = memoryProjectPickerRef as typeof bag.memoryProjectPickerRef;

  useEffect(() => { bag.setMemoryProjectWorkspace(bag.workspace || "__all__"); }, [bag.workspace]);

  useEffect(() => {
    if (!bag.memoryProjectMenuOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !bag.memoryProjectPickerRef.current?.contains(target)) bag.setMemoryProjectMenuOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") bag.setMemoryProjectMenuOpen(false); };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => { document.removeEventListener("pointerdown", close, true); document.removeEventListener("keydown", onKeyDown, true); };
  }, [bag.memoryProjectMenuOpen]);

  function openAppPrompt(title: string, defaultValue = "", multiline = false): Promise<string | null> {
    return new Promise((resolve) => bag.setAppPrompt({ title, value: defaultValue, multiline, resolve }));
  }
bag.openAppPrompt = openAppPrompt as typeof bag.openAppPrompt;

  function openAppConfirm(title: string, text: string, confirmLabel = "确定"): Promise<boolean> {
    return new Promise((resolve) => bag.setAppConfirm({ title, text, confirmLabel, resolve }));
  }
bag.openAppConfirm = openAppConfirm as typeof bag.openAppConfirm;

  useLayoutEffect(() => {
    if (!bag.appPrompt) return;
    const focusPrompt = () => {
      const input = bag.appPromptInputRef.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      input.select();
    };
    focusPrompt();
    const frame = requestAnimationFrame(() => {
      if (document.activeElement !== bag.appPromptInputRef.current) focusPrompt();
    });
    return () => cancelAnimationFrame(frame);
  }, [bag.appPrompt]);

  // 专家团（Team 型专家）：团队列表 + 编辑 + 成员调度状态
  const [expertTeams, setExpertTeams] = useState<ExpertTeamConfig[]>([]);
bag.expertTeams = expertTeams as typeof bag.expertTeams; bag.setExpertTeams = setExpertTeams as typeof bag.setExpertTeams;

  const [expertTeamDraft, setExpertTeamDraft] = useState<ExpertTeamConfig | null>(null);
bag.expertTeamDraft = expertTeamDraft as typeof bag.expertTeamDraft; bag.setExpertTeamDraft = setExpertTeamDraft as typeof bag.setExpertTeamDraft;

  const [expertTeamEditorOpen, setExpertTeamEditorOpen] = useState(false);
bag.expertTeamEditorOpen = expertTeamEditorOpen as typeof bag.expertTeamEditorOpen; bag.setExpertTeamEditorOpen = setExpertTeamEditorOpen as typeof bag.setExpertTeamEditorOpen;

  const [expertTeamRunning, setExpertTeamRunning] = useState<string | null>(null);
bag.expertTeamRunning = expertTeamRunning as typeof bag.expertTeamRunning; bag.setExpertTeamRunning = setExpertTeamRunning as typeof bag.setExpertTeamRunning;

  const [expertTeamMemberRunning, setExpertTeamMemberRunning] = useState<{ teamId: string; memberName: string } | null>(null);
bag.expertTeamMemberRunning = expertTeamMemberRunning as typeof bag.expertTeamMemberRunning; bag.setExpertTeamMemberRunning = setExpertTeamMemberRunning as typeof bag.setExpertTeamMemberRunning;

  // ── 专家团运行记录（09-14）：成员头像轨 / 成员工作弹窗 / 成员历史工作记录的**唯一数据源** ──
  // 权威在主进程（electron/team-runs.ts），经 harness:event 的 team-run 广播给所有窗口，
  // 所以 popout 独立窗口看到的状态与主窗口一致。
  const [teamRuns, setTeamRuns] = useState<Record<string, TeamMemberRunRecord>>({});
bag.teamRuns = teamRuns as typeof bag.teamRuns; bag.setTeamRuns = setTeamRuns as typeof bag.setTeamRuns;

  /** 正在展示工作弹窗的那次委托（空串 = 不展示） */
  const [teamPopupRunId, setTeamPopupRunId] = useState("");
bag.teamPopupRunId = teamPopupRunId as typeof bag.teamPopupRunId; bag.setTeamPopupRunId = setTeamPopupRunId as typeof bag.setTeamPopupRunId;

  /** 正在查看历史工作记录的成员 id（空串 = 不展示） */
  const [teamHistoryMember, setTeamHistoryMember] = useState("");
bag.teamHistoryMember = teamHistoryMember as typeof bag.teamHistoryMember; bag.setTeamHistoryMember = setTeamHistoryMember as typeof bag.setTeamHistoryMember;

  /** 当前打开的会话属于哪个专家团。popout 窗口没有 teamThreadMapRef，靠主进程映射解析。 */
  const [threadTeamId, setThreadTeamId] = useState("");
bag.threadTeamId = threadTeamId as typeof bag.threadTeamId; bag.setThreadTeamId = setThreadTeamId as typeof bag.setThreadTeamId;

  const [teamHistoryRuns, setTeamHistoryRuns] = useState<TeamMemberRunRecord[]>([]);
bag.teamHistoryRuns = teamHistoryRuns as typeof bag.teamHistoryRuns; bag.setTeamHistoryRuns = setTeamHistoryRuns as typeof bag.setTeamHistoryRuns;

  const teamRunsRef = useRef<Record<string, TeamMemberRunRecord>>({});
bag.teamRunsRef = teamRunsRef as typeof bag.teamRunsRef;

  bag.teamRunsRef.current = bag.teamRuns;

  const teamDeltaRef = useRef<Map<string, string>>(new Map());
bag.teamDeltaRef = teamDeltaRef as typeof bag.teamDeltaRef;

  const teamFlushRef = useRef<number | null>(null);
bag.teamFlushRef = teamFlushRef as typeof bag.teamFlushRef;

  /** 正在跑的成员委托数（并行阶段会 >1）：活动指示器按计数收敛，不能在单个任务结束时清空 */
  const teamRunningCountRef = useRef(0);
bag.teamRunningCountRef = teamRunningCountRef as typeof bag.teamRunningCountRef;
  return { mcpOverrides, setMcpOverrides, mcpToolPermissions, setMcpToolPermissions, mcpServerChecked, setMcpServerChecked, mcpServerStatusBusy, setMcpServerStatusBusy, mcpServerBatchBusy, setMcpServerBatchBusy, mcpServerSearch, setMcpServerSearch, subAgents, setSubAgents, subAgentDraft, setSubAgentDraft, subAgentEditorOpen, setSubAgentEditorOpen, subAgentRunning, setSubAgentRunning, rpaRunning, setRpaRunning, agentAsk, setAgentAsk, rpaRecipes, setRpaRecipes, taskList, setTaskList, threadPermPushAtRef, appPromptInputRef, appConfirm, setAppConfirm, appPrompt, setAppPrompt, memoryPreview, setMemoryPreview, searchPreview, setSearchPreview, memoryCenterOpen, setMemoryCenterOpen, memoryCenterTab, setMemoryCenterTab, memoryProjectWorkspace, setMemoryProjectWorkspace, memoryProjectEnabled, setMemoryProjectEnabled, memoryProjectMenuOpen, setMemoryProjectMenuOpen, memoryProjectPickerRef, openAppPrompt, openAppConfirm, expertTeams, setExpertTeams, expertTeamDraft, setExpertTeamDraft, expertTeamEditorOpen, setExpertTeamEditorOpen, expertTeamRunning, setExpertTeamRunning, expertTeamMemberRunning, setExpertTeamMemberRunning, teamRuns, setTeamRuns, teamPopupRunId, setTeamPopupRunId, teamHistoryMember, setTeamHistoryMember, threadTeamId, setThreadTeamId, teamHistoryRuns, setTeamHistoryRuns, teamRunsRef, teamDeltaRef, teamFlushRef, teamRunningCountRef };
}
