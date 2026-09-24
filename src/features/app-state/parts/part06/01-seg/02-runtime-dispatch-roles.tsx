/**
 * usePart06a2 —— usePart06a 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：设置内容就绪/搜索防抖/流时间戳/基调 — 运行态与派发 · 委托记录 · 角色
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { LEGACY_PREFIX, dispatchSignature, emptyDispatch, emptyRuntime, isOwnEcho, legacyMirror, migrateRuntime, normalizeDispatch, normalizeRuntime, patchRuntime, rememberOwnWrite, runtimeKey, runtimeSignature } from "../../../../../lib/thread-runtime.mjs";
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "../../../../../lib/user-refs";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";

export function usePart06a2(bag: Bag) {
  // ── 多窗口一致性（09-14）：主进程回来的权威运行时 → 镜像 + React 状态 ─────────────────
  /** 当前 React 状态里的四项会话级取值。**必须走 ref**：onHarnessEvent 的监听是在挂载时
   *  注册的，直接闭包捕获 state 会拿到首帧的旧值（"", "never"…），导致「值没变也判成变了」。 */
  const runtimeStateRef = useRef({ model: "", effort: "", sandbox: "", approval: "" });
bag.runtimeStateRef = runtimeStateRef as typeof bag.runtimeStateRef;


  bag.runtimeStateRef.current = { model: bag.modelId, effort: bag.effort, sandbox: bag.sandbox, approval: bag.approvalPolicy };


  /** 每个会话「已采纳过」的最大 rev：迟到的响应/广播（rev 更小）一律丢弃，避免回退到中间态。 */
  const adoptedRevRef = useRef<Record<string, number>>({});
bag.adoptedRevRef = adoptedRevRef as typeof bag.adoptedRevRef;



  // ── 调度（09-15）：可调度对象目录 / 被调度的临时会话 ─────────────────────────────
  const [dispatchInfo, setDispatchInfo] = useState<{ description: string; targets: DispatchTargetEntry[] }>({ description: "", targets: [] });
bag.dispatchInfo = dispatchInfo as typeof bag.dispatchInfo; bag.setDispatchInfo = setDispatchInfo as typeof bag.setDispatchInfo;


  /** 被调度产生的临时会话（threadId → 记录）：侧栏标记 + 注册侧过滤（L2）都读它 */
  const [delegateRecords, setDelegateRecords] = useState<Record<string, DelegateRecordEntry>>({});
bag.delegateRecords = delegateRecords as typeof bag.delegateRecords; bag.setDelegateRecords = setDelegateRecords as typeof bag.setDelegateRecords;


  // 调度独占锁的当前持有者（全局唯一，权威值在主进程）。非持有会话的开关要灰掉并显示占用者。
  const [dispatchOwnerId, setDispatchOwnerId] = useState<string | null>(null);
bag.dispatchOwnerId = dispatchOwnerId as typeof bag.dispatchOwnerId; bag.setDispatchOwnerId = setDispatchOwnerId as typeof bag.setDispatchOwnerId;


  const refreshDispatchOwner = useCallback(async () => {
    try {
      const res: any = await window.codex.dispatchOwner();
      bag.setDispatchOwnerId(res?.threadId ? String(res.threadId) : null);
    } catch { /* 拿不到就按「没有持有者」渲染，写入时主进程仍会拦 */ }
  }, []);
bag.refreshDispatchOwner = refreshDispatchOwner as typeof bag.refreshDispatchOwner;


  // 受保护会话（专家 / 专家团 / 被调度的临时会话）：调度按钮直接禁用 ——
  // 这些会话有自己的团内协作通道，对外派人会让「谁在干活」失控（用户 09-16 明确要求）。
  const [threadRole, setThreadRole] = useState<{ restricted: boolean; label?: string }>({ restricted: false });
bag.threadRole = threadRole as typeof bag.threadRole; bag.setThreadRole = setThreadRole as typeof bag.setThreadRole;


  const refreshThreadRole = useCallback(async (threadId?: string) => {
    if (!threadId) { bag.setThreadRole({ restricted: false }); return; }
    try {
      const res: any = await window.codex.threadRole(threadId);
      bag.setThreadRole(res?.restricted ? { restricted: true, label: String(res.label ?? "专家 / 专家团") } : { restricted: false });
    } catch { bag.setThreadRole({ restricted: false }); /* 拿不到不误禁（主进程硬闸仍在） */ }
  }, []);
bag.refreshThreadRole = refreshThreadRole as typeof bag.refreshThreadRole;



  // buildDynamicTools 是 useCallback（依赖只有 memoryEnabled/subAgents），闭包里的 thread 是旧的
  // —— 所以调度判定一律走 ref 镜像读「此刻」的真实状态，不依赖闭包。
  const delegateRecordsRef = useRef<Record<string, DelegateRecordEntry>>({});
bag.delegateRecordsRef = delegateRecordsRef as typeof bag.delegateRecordsRef;


  const dispatchInfoRef = useRef<{ description: string; targets: DispatchTargetEntry[] }>({ description: "", targets: [] });
bag.dispatchInfoRef = dispatchInfoRef as typeof bag.dispatchInfoRef;



  const refreshDispatchInfo = useCallback(async () => {
    try {
      const [desc, cat] = await Promise.all([window.codex.dispatchToolDescription(), window.codex.listDispatchCatalog()]);
      const next = {
        description: String((desc as any)?.description ?? ""),
        targets: Array.isArray((cat as any)?.targets) ? (cat as any).targets : [],
      };
      bag.dispatchInfoRef.current = next;
      bag.setDispatchInfo(next);
    } catch { /* 拿不到目录就不注册工具：宁可没有，也不要一个描述空的工具让模型乱猜 */ }
  }, []);
bag.refreshDispatchInfo = refreshDispatchInfo as typeof bag.refreshDispatchInfo;



  const refreshDelegateRecords = useCallback(async () => {
    try {
      const res: any = await window.codex.listDelegates();
      const map: Record<string, DelegateRecordEntry> = {};
      for (const record of (Array.isArray(res?.records) ? res.records : [])) map[String(record.threadId)] = record;
      bag.delegateRecordsRef.current = map;
      bag.setDelegateRecords(map);
      // 调度头像轨的数据源（窗口中途打开/重开也要能看到正在跑的）：
      // 以登记表为准 —— running 的补进 live 表；非 running 的**不立刻摘**（那是「停留 20 秒」的职责，
      // 由 finished 广播的计时器负责），只在它压根不在表里时也不补（已结束的没必要复活）。
      bag.setDelegateLiveRuns((prev) => {
        const next = { ...prev };
        for (const record of Object.values(map)) {
          if (record.status === "running") {
            next[record.threadId] = next[record.threadId] ?? {
              threadId: record.threadId, originThreadId: record.originThreadId, kind: record.kind,
              name: record.name, status: "running", output: record.output ?? "", startedAt: record.startedAt,
            };
          }
        }
        return next;
      });
    } catch { /* 忽略：拿不到就按「没有调度会话」渲染 */ }
  }, []);
bag.refreshDelegateRecords = refreshDelegateRecords as typeof bag.refreshDelegateRecords;



  // 可调度对象会随专家/子智能体的启用状态变化 → 工具说明书跟着刷新；
  // 调度记录启动拉一次，之后由 harness 广播的 delegates-changed 增量刷新。
  useEffect(() => { void bag.refreshDispatchInfo(); }, [bag.refreshDispatchInfo, bag.expertTeams, bag.subAgents]);


  useEffect(() => { void bag.refreshDelegateRecords(); }, [bag.refreshDelegateRecords]);



  const [dispatchBusy, setDispatchBusy] = useState(false);
bag.dispatchBusy = dispatchBusy as typeof bag.dispatchBusy; bag.setDispatchBusy = setDispatchBusy as typeof bag.setDispatchBusy;


  /** 调度头像轨的 live 表（09-16）：含**正在跑**与**刚跑完停留中**的委派会话。
   *  事件源 = 主进程 delegate-run 广播（started / delta / finished），种子 = listDelegates。 */
  const [delegateLiveRuns, setDelegateLiveRuns] = useState<Record<string, DelegateRecordEntry>>({});
bag.delegateLiveRuns = delegateLiveRuns as typeof bag.delegateLiveRuns; bag.setDelegateLiveRuns = setDelegateLiveRuns as typeof bag.setDelegateLiveRuns;


  const [delegatedPopupId, setDelegatedPopupId] = useState("");
bag.delegatedPopupId = delegatedPopupId as typeof bag.delegatedPopupId; bag.setDelegatedPopupId = setDelegatedPopupId as typeof bag.setDelegatedPopupId;


  /** 跑完后的停留计时器（用户 09-16：头像停留 20 秒，方便查看内容）；卸载时统一清理 */
  const delegateRailTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
bag.delegateRailTimersRef = delegateRailTimersRef as typeof bag.delegateRailTimersRef;


  useEffect(() => () => { for (const timer of bag.delegateRailTimersRef.current.values()) clearTimeout(timer); bag.delegateRailTimersRef.current.clear(); }, []);


  /** 调度开关存在会话运行时（localStorage）里，React 感知不到变化 → 用一个 tick 触发重算 */
  const [dispatchTick, setDispatchTick] = useState(0);
bag.dispatchTick = dispatchTick as typeof bag.dispatchTick; bag.setDispatchTick = setDispatchTick as typeof bag.setDispatchTick;


  const activeDispatch = useMemo(
    () => (bag.thread?.id ? loadThreadRuntime(bag.thread.id).dispatch : emptyDispatch()),
    [bag.thread?.id, bag.dispatchTick],
  );
bag.activeDispatch = activeDispatch as typeof bag.activeDispatch;


  /** 调度独占锁被**别的会话**持有时显示它的名字（本会话是持有者则 null）。 */
  const dispatchHolderName = useMemo(() => {
    if (!bag.dispatchOwnerId || bag.dispatchOwnerId === bag.thread?.id) return null;
    const found = bag.threads.find((entry) => entry.id === bag.dispatchOwnerId);
    const label = found ? cleanThreadDisplayTitle(found.name, { preview: found.preview }) : "";
    return label?.trim() || "另一个会话";
  }, [bag.dispatchOwnerId, bag.thread?.id, bag.threads]);
bag.dispatchHolderName = dispatchHolderName as typeof bag.dispatchHolderName;
  return { runtimeStateRef, adoptedRevRef, dispatchInfo, setDispatchInfo, delegateRecords, setDelegateRecords, dispatchOwnerId, setDispatchOwnerId, refreshDispatchOwner, threadRole, setThreadRole, refreshThreadRole, delegateRecordsRef, dispatchInfoRef, refreshDispatchInfo, refreshDelegateRecords, dispatchBusy, setDispatchBusy, delegateLiveRuns, setDelegateLiveRuns, delegatedPopupId, setDelegatedPopupId, delegateRailTimersRef, dispatchTick, setDispatchTick, activeDispatch, dispatchHolderName };
}
