/**
 * usePart02a2 —— usePart02a 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：MCP 覆盖与工具权限 · 子代理状态 — 专家团映射/角色记忆/待导入
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { avatarToneOf, AVATAR_GRADIENTS, registerThreadTeam, unregisterThreadTeam, resolveTeamMember } from "../../../../../lib/entity-avatar";
import { expertRoleLabel } from "../../../../../lib/expert-role-label";
import { readPendingImportStore } from "../../../../../lib/read-pending-import-store";
import { PENDING_IMPORT_STORE_KEY } from "../../../../../lib/pending-import-store-key";
import type { Bag } from "../../bag-types";

export function usePart02a2(bag: Bag) {
  // 打开会话时把主进程的 threadId→teamId 映射读回来：popout 独立窗口的团队映射表是空的，
  // 只有主进程那份落盘映射才知道「这个会话属于哪个团」。
  useEffect(() => {
    const id = bag.thread?.id ?? "";
    if (!id) { bag.setThreadTeamId(""); return; }
    bag.setThreadTeamId(bag.teamThreadMapRef.current.get(id) ?? "");
    let alive = true;
    void window.codex.teamOfThread?.(id).then((teamId) => {
      if (alive && teamId) bag.setThreadTeamId(String(teamId));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [bag.thread?.id]);

  // 打开某会话时把该团队的**历史委托记录**载进来（头像轨据此显示「谁干过活、最近一次什么结果」）
  useEffect(() => {
    const id = bag.thread?.id ?? "";
    if (!id) return;
    let alive = true;
    void window.codex.listTeamRuns?.(id).then((runs) => {
      if (!alive || !Array.isArray(runs) || !runs.length) return;
      bag.setTeamRuns((prev) => {
        const next = { ...prev };
        for (const run of runs) if (run?.runId && !next[run.runId]) next[run.runId] = run;
        return next;
      });
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [bag.thread?.id]);

  // 成员工作弹窗：委托一结束就自动收起（留 2.4s 让用户看完「已完成」与产出尾巴）
  useEffect(() => {
    if (!bag.teamPopupRunId) return;
    const run = bag.teamRunsRef.current[bag.teamPopupRunId];
    if (!run || run.status === "running") return;
    const timer = setTimeout(() => bag.setTeamPopupRunId((current) => (current === bag.teamPopupRunId ? "" : current)), 2400);
    return () => clearTimeout(timer);
  }, [bag.teamPopupRunId, bag.teamRuns]);

  // 打开某成员的「历史工作记录」时，从主进程读该团队会话的全部委托记录
  useEffect(() => {
    const id = bag.thread?.id ?? "";
    if (!bag.teamHistoryMember || !id) { bag.setTeamHistoryRuns([]); return; }
    let alive = true;
    void window.codex.listTeamRuns?.(id).then((runs) => { if (alive) bag.setTeamHistoryRuns(Array.isArray(runs) ? runs : []); }).catch(() => { if (alive) bag.setTeamHistoryRuns([]); });
    return () => { alive = false; };
  }, [bag.teamHistoryMember, bag.thread?.id, bag.teamRuns]);

  // 每张专家团卡片独立选择的项目地址（teamId -> cwd）；未选择时用全局 workspace
  const [teamCwdMap, setTeamCwdMap] = useState<Record<string, string>>({});
bag.teamCwdMap = teamCwdMap as typeof bag.teamCwdMap; bag.setTeamCwdMap = setTeamCwdMap as typeof bag.setTeamCwdMap;

  // 成员直达会话进行中标记（key = teamId:memberId），用于成员 chip 的 loading 态
  const [expertTeamMemberDirect, setExpertTeamMemberDirect] = useState<string | null>(null);
bag.expertTeamMemberDirect = expertTeamMemberDirect as typeof bag.expertTeamMemberDirect; bag.setExpertTeamMemberDirect = setExpertTeamMemberDirect as typeof bag.setExpertTeamMemberDirect;

  // threadId -> teamId 映射：tool call 事件只带 threadId，据此解析当前团队
  const teamThreadMapRef = useRef<Map<string, string>>(new Map());
bag.teamThreadMapRef = teamThreadMapRef as typeof bag.teamThreadMapRef;

  // 团队父会话自己的运行配置。后台会话调度成员时不能读取当前屏幕上的 workspace/model，
  // 否则切到另一个会话后会把新会话配置错误套给旧团队。
  const teamThreadConfigRef = useRef<Map<string, { teamId: string; cwd: string; model: string; effort?: string; sandbox: string; approvalPolicy: string }>>(new Map());
bag.teamThreadConfigRef = teamThreadConfigRef as typeof bag.teamThreadConfigRef;

  // 把「threadId → 团队成员解析」注册进模块级注册表，聊天区深处的 ItemView 渲染
  // team_member_invoke 工具卡时能查到成员头像（不逐层传 props，见 entity-avatar.ts 注释）
  useEffect(() => {
    for (const [threadId, teamId] of bag.teamThreadMapRef.current) {
      const team = bag.expertTeams.find((entry) => entry.teamId === teamId);
      if (!team) continue;
      registerThreadTeam(threadId, (memberId) => {
        const member = [team.lead, ...team.members].find((entry) => entry.id === memberId);
        if (!member) return null;
        const isLead = member.id === team.lead.id;
        return { id: member.id, name: member.name, label: expertRoleLabel(member, isLead), isLead };
      });
    }
    return () => { for (const threadId of bag.teamThreadMapRef.current.keys()) unregisterThreadTeam(threadId); };
  }, [bag.expertTeams]);

  // defer 预建的空会话：threadId -> 首条待注入角色。用户在该空会话发出第一条消息时，
  // 发送管线自动包装成 SYSTEM TASK（渲染折叠为「需求已发起」），包装后即清除本映射。
  const pendingExpertRoleRef = useRef<Map<string, ExpertPendingRole>>(new Map());
bag.pendingExpertRoleRef = pendingExpertRoleRef as typeof bag.pendingExpertRoleRef;

  // 角色映射同时落 localStorage：空会话可能闲置到应用重启后用户才发首条消息，
  // 重启后 ref 已空，send() 会从 localStorage 兜底取回角色包装。key = localStorage 键。
  const EXPERT_ROLE_STORE_KEY = "expert-pending-roles";
bag.EXPERT_ROLE_STORE_KEY = EXPERT_ROLE_STORE_KEY as typeof bag.EXPERT_ROLE_STORE_KEY;

  const rememberExpertRole = (threadId: string, role: ExpertPendingRole) => {
    bag.pendingExpertRoleRef.current.set(threadId, role);
    try {
      const next = { ...(JSON.parse(localStorage.getItem(bag.EXPERT_ROLE_STORE_KEY) || "{}") as Record<string, ExpertPendingRole>), [threadId]: role };
      localStorage.setItem(bag.EXPERT_ROLE_STORE_KEY, JSON.stringify(next));
    } catch { /* 存储失败仅影响重启后的首条包装，不阻塞 */ }
  };
bag.rememberExpertRole = rememberExpertRole as typeof bag.rememberExpertRole;

  const forgetExpertRole = (threadId: string) => {
    bag.pendingExpertRoleRef.current.delete(threadId);
    try {
      const store = JSON.parse(localStorage.getItem(bag.EXPERT_ROLE_STORE_KEY) || "{}") as Record<string, ExpertPendingRole>;
      if (store[threadId]) { delete store[threadId]; localStorage.setItem(bag.EXPERT_ROLE_STORE_KEY, JSON.stringify(store)); }
    } catch { /* ignore */ }
  };
bag.forgetExpertRole = forgetExpertRole as typeof bag.forgetExpertRole;

  const readStoredExpertRole = (threadId: string): ExpertPendingRole | undefined => {
    if (bag.pendingExpertRoleRef.current.has(threadId)) return bag.pendingExpertRoleRef.current.get(threadId);
    try { return (JSON.parse(localStorage.getItem(bag.EXPERT_ROLE_STORE_KEY) || "{}") as Record<string, ExpertPendingRole>)[threadId]; }
    catch { return undefined; }
  };
bag.readStoredExpertRole = readStoredExpertRole as typeof bag.readStoredExpertRole;

  // 导入记录新建的空会话：threadId -> 待附外部对话记录。首条消息发送时随消息附上（见 send），
  // 成功后清除。pendingImportThreads 只存「有记录的线程 id」做响应式判断（渲染用），
  // 记录全文在 localStorage（key = PENDING_IMPORT_STORE_KEY），避免把大文本塞进 state 造成流式渲染卡顿。
  const [pendingImportThreads, setPendingImportThreads] = useState<Record<string, true>>(() => {
    const store = readPendingImportStore();
    return Object.keys(store).reduce<Record<string, true>>((acc, id) => { acc[id] = true; return acc; }, {});
  });
bag.pendingImportThreads = pendingImportThreads as typeof bag.pendingImportThreads; bag.setPendingImportThreads = setPendingImportThreads as typeof bag.setPendingImportThreads;

  const rememberPendingImport = (threadId: string, payload: PendingImportPayload) => {
    try {
      const next = { ...readPendingImportStore(), [threadId]: payload };
      localStorage.setItem(PENDING_IMPORT_STORE_KEY, JSON.stringify(next));
    } catch { /* 存储失败仅影响重启后恢复，不阻塞 */ }
    bag.setPendingImportThreads((current) => ({ ...current, [threadId]: true }));
  };
bag.rememberPendingImport = rememberPendingImport as typeof bag.rememberPendingImport;

  const forgetPendingImport = (threadId: string) => {
    try {
      const store = readPendingImportStore();
      if (store[threadId]) { delete store[threadId]; localStorage.setItem(PENDING_IMPORT_STORE_KEY, JSON.stringify(store)); }
    } catch { /* ignore */ }
    bag.setPendingImportThreads((current) => {
      if (!current[threadId]) return current;
      const next = { ...current };
      delete next[threadId];
      return next;
    });
  };
bag.forgetPendingImport = forgetPendingImport as typeof bag.forgetPendingImport;

  const readStoredPendingImport = (threadId: string): PendingImportPayload | undefined => {
    try { return readPendingImportStore()[threadId]; } catch { return undefined; }
  };
bag.readStoredPendingImport = readStoredPendingImport as typeof bag.readStoredPendingImport;

  const [panelWidth, setPanelWidth] = useState(() => Math.min(560, Math.max(240, Number(localStorage.getItem("panel-width")) || 308)));
bag.panelWidth = panelWidth as typeof bag.panelWidth; bag.setPanelWidth = setPanelWidth as typeof bag.setPanelWidth;

  const dragWidthRef = useRef(bag.panelWidth);
bag.dragWidthRef = dragWidthRef as typeof bag.dragWidthRef;

  const shellRef = useRef<HTMLDivElement>(null);
bag.shellRef = shellRef as typeof bag.shellRef;

  function startPanelDrag(event: ReactMouseEvent) {
    event.preventDefault();
    // 性能关键：拖拽期间直接改 shell 的 grid 样式（不走 React state）——
    // 此前每个 mousemove setPanelWidth 触发整棵应用重渲染，拖动明显卡顿。
    // mouseup 才提交 state 并落盘，重渲染仅一次。
    const shell = bag.shellRef.current;
    const sidebarCollapsedNow = bag.sidebarCollapsed;
    const move = (e: MouseEvent) => {
      const width = Math.min(560, Math.max(240, window.innerWidth - e.clientX));
      bag.dragWidthRef.current = width;
      if (shell) shell.style.gridTemplateColumns = `${sidebarCollapsedNow ? "minmax(0, 1fr)" : "256px minmax(0, 1fr)"} 1px ${width}px`;
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      localStorage.setItem("panel-width", String(bag.dragWidthRef.current));
      bag.setPanelWidth(bag.dragWidthRef.current);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }
bag.startPanelDrag = startPanelDrag as typeof bag.startPanelDrag;

  const [planSteps, setPlanSteps] = useState<{ step: string; status: string }[]>([]);
bag.planSteps = planSteps as typeof bag.planSteps; bag.setPlanSteps = setPlanSteps as typeof bag.setPlanSteps;

  const [goalText, setGoalText] = useState("");
bag.goalText = goalText as typeof bag.goalText; bag.setGoalText = setGoalText as typeof bag.setGoalText;

  const [goalsOpen, setGoalsOpen] = useState(true);
bag.goalsOpen = goalsOpen as typeof bag.goalsOpen; bag.setGoalsOpen = setGoalsOpen as typeof bag.setGoalsOpen;

  const [doneExpanded, setDoneExpanded] = useState(false);
bag.doneExpanded = doneExpanded as typeof bag.doneExpanded; bag.setDoneExpanded = setDoneExpanded as typeof bag.setDoneExpanded;

  // ── /plan 计划模式（引擎原生 collaborationMode=plan）──
  // planOnceRef：一次性旗标，下一次 send() 以 plan 协作模式启动回合；
  // 方案回合正常结束后进入 planConfirm，用户确认后再以默认模式原任务执行。
  const planOnceRef = useRef(false);
bag.planOnceRef = planOnceRef as typeof bag.planOnceRef;

  const planTurnRef = useRef<{ threadId: string; turnId: string } | null>(null);
bag.planTurnRef = planTurnRef as typeof bag.planTurnRef;

  const [planArmed, setPlanArmed] = useState(false);
bag.planArmed = planArmed as typeof bag.planArmed; bag.setPlanArmed = setPlanArmed as typeof bag.setPlanArmed;

 // 输入框小徽标：下一条消息将以计划模式执行，可叉掉
  const [planRunning, setPlanRunning] = useState(false);
bag.planRunning = planRunning as typeof bag.planRunning; bag.setPlanRunning = setPlanRunning as typeof bag.setPlanRunning;

 // 计划回合执行中，徽标保持显示，叉掉=中断
  const [planConfirm, setPlanConfirm] = useState<{ threadId: string; text: string } | null>(null);
bag.planConfirm = planConfirm as typeof bag.planConfirm; bag.setPlanConfirm = setPlanConfirm as typeof bag.setPlanConfirm;

  const [planFeedback, setPlanFeedback] = useState("");
bag.planFeedback = planFeedback as typeof bag.planFeedback; bag.setPlanFeedback = setPlanFeedback as typeof bag.setPlanFeedback;
  return { teamCwdMap, setTeamCwdMap, expertTeamMemberDirect, setExpertTeamMemberDirect, teamThreadMapRef, teamThreadConfigRef, pendingExpertRoleRef, EXPERT_ROLE_STORE_KEY, rememberExpertRole, forgetExpertRole, readStoredExpertRole, pendingImportThreads, setPendingImportThreads, rememberPendingImport, forgetPendingImport, readStoredPendingImport, panelWidth, setPanelWidth, dragWidthRef, shellRef, startPanelDrag, planSteps, setPlanSteps, goalText, setGoalText, goalsOpen, setGoalsOpen, doneExpanded, setDoneExpanded, planOnceRef, planTurnRef, planArmed, setPlanArmed, planRunning, setPlanRunning, planConfirm, setPlanConfirm, planFeedback, setPlanFeedback };
}
