/** 排队消息 / 折叠流 / 渐进体（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { useState, useMemo, useEffect, memo, Fragment } from "react";
import { ChevronDown, ChevronRight, GripVertical, Clock3, Image, ArrowUp, PenLine, Trash2, TerminalSquare, FileCode2, Search, Bot, Brain, Wrench } from "lucide-react";
import { parseUserRefs } from "../../lib/user-refs";
import type { ParsedUserRefs } from "../../lib/user-refs";
import { isImagePart } from "../../lib/prompt-images";
import { UserRefsRow } from "../inline-cards";
import { ImportedRecordCard } from "../import-records";
import { Fold } from "../shared/Fold";
import { ThreadItem } from "../../lib/thread-item";
import { Turn } from "../../lib/turn";
import { classifyUnit, buildSegments, foldItemStatus, computeFoldSummary, topToolGroup } from "../../lib/turn-fold";
import type { FoldUnit } from "../../lib/turn-fold";
import { CappedToolSequence } from "../session-cards";
import { formatDuration } from "../../lib/format-duration";
import { describeTurnStop, turnHeadline } from "../../lib/turn-stop-reason.mjs";
import { planCompletedFold } from "../../lib/turn-fold-plan.mjs";
import { QueueItem } from "../../lib/queue-item";
import { inputText } from "../../lib/input-text";
import { reasoningDuration } from "../../lib/reasoning-duration";
import { ItemView } from "./ItemView";

export function QueuedMessageList({ entries, onOpenFile, onQuote, onDelete, onStart, onSave, onReorder, dragIndex, setDragIndex }: {
  entries: QueueItem[];
  onOpenFile: (path: string) => void;
  onQuote: (text: string) => void;
  onDelete: (id: string) => void;
  onStart: (id?: string) => void;
  onSave: (entry: QueueItem, text: string) => void;
  onReorder: (from: number, to: number) => void;
  dragIndex: number | null;
  setDragIndex: (index: number | null) => void;
}) {
  // 折叠语义（用户 09-13 定稿）：「排队消息只贴在输入框上面展示」+「超过 2 条可以折叠」。
  // 所以：≤2 条全展示、不显示折叠控件；>2 条**默认只展示最新 2 条**，展开/收起由用户控制。
  // （原来 n>=2 就给个手动开关、默认全展示，条数一多就把输入框顶上去。）
  const [expanded, setExpanded] = useState(false);
  if (!entries.length) return null;
  // 新消息往上叠加：渲染倒序（数组末尾的最新消息显示在最顶部）。拖拽 index 是显示序，需镜像回原数组序。
  const reversed = [...entries].reverse();
  const n = entries.length;
  const collapsible = n > 2;
  const visible = collapsible && !expanded ? reversed.slice(0, 2) : reversed;
  const hiddenCount = n - visible.length;
  const mapIndex = (displayIndex: number) => n - 1 - displayIndex;
  return (
    <div className="queued-messages">
      {collapsible && (
        <button type="button" className="queued-collapse-toggle" onClick={() => setExpanded((value) => !value)} title={expanded ? "只看最新 2 条" : `展开全部 ${n} 条`}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="">排队消息</span>
          <span className="queued-collapse-count">{n}</span>
          <span className="queued-collapse-hint">{expanded ? "收起" : `展开全部 ${n} 条（还有 ${hiddenCount} 条）`}</span>
        </button>
      )}
      {visible.map((entry, displayIndex) => <QueuedMessageItem key={entry.id} entry={entry} index={displayIndex} total={entries.length} onOpenFile={onOpenFile} onQuote={onQuote} onDelete={onDelete} onStart={onStart} onSave={onSave} onReorder={(from, to) => onReorder(mapIndex(from), mapIndex(to))} dragIndex={dragIndex} setDragIndex={setDragIndex} />)}
    </div>
  );
}

export function QueuedMessageItem({ entry, index, total, onOpenFile, onQuote, onDelete, onStart, onSave, onReorder, dragIndex, setDragIndex }: {
  entry: QueueItem; index: number; total: number;
  onOpenFile: (path: string) => void; onQuote: (text: string) => void;
  onDelete: (id: string) => void; onStart: (id?: string) => void; onSave: (entry: QueueItem, text: string) => void;
  onReorder: (from: number, to: number) => void; dragIndex: number | null; setDragIndex: (index: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => inputText(entry.input));
  const rawText = inputText(entry.input);
  const refs = useMemo<ParsedUserRefs>(() => parseUserRefs(rawText), [rawText]);
  const images = (entry.input ?? []).filter(isImagePart);
  const saving = () => { setEditing(false); onSave(entry, draft); };
  if (editing) {
    return (
      <div className="queued-message queued-message-editing" data-queued-id={entry.id}>
        <textarea value={draft} autoFocus onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setEditing(false); else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) saving(); }} placeholder="编辑排队消息内容" />
        <div className="queued-edit-actions">
          <button className="ghost" onClick={() => setEditing(false)}>取消</button>
          <button disabled={!draft.trim() && !images.length} onClick={saving}>保存</button>
        </div>
      </div>
    );
  }
  return (
    <div
      className={`queued-message ${dragIndex === index ? "dragging" : ""}`}
      data-queued-id={entry.id}
      draggable
      onDragStart={() => setDragIndex(index)}
      onDragOver={(event) => { event.preventDefault(); if (dragIndex != null && dragIndex !== index) { onReorder(dragIndex, index); setDragIndex(index); } }}
      onDragEnd={() => setDragIndex(null)}
      title={total > 1 ? "拖动可调整排队顺序" : undefined}
    >
      <span className="queued-grip" aria-hidden="true"><GripVertical size={14} /></span>
      <div className="queued-main">
        <span className="queued-badge"><Clock3 size={11} />排队中{total > 1 ? ` ${index + 1}/${total}` : ""}</span>
        <UserRefsRow refs={refs} onOpenFile={onOpenFile} onQuote={onQuote} />
        {refs.threadReferences.map((reference) => <ImportedRecordCard key={reference.id} note={reference.note} content={reference.content} kind="thread" />)}
        {refs.cleanText && <span className="queued-text">{refs.cleanText}</span>}
        {images.map((part: any, idx: number) => <span className="queued-image-chip" key={idx}><Image size={13} />{part.path}</span>)}
      </div>
      <div className="queued-actions">
        <button className="queued-action" title="立即注入思路（不打断当前任务）" onClick={() => onStart(entry.id)}><ArrowUp size={13} />立即</button>
        <button className="queued-action" title="编辑排队消息" onClick={() => { setDraft(inputText(entry.input)); setEditing(true); }}><PenLine size={13} />编辑</button>
        <button className="queued-action danger" title="删除排队消息" onClick={() => onDelete(entry.id)}><Trash2 size={13} />删除</button>
      </div>
    </div>
  );
}

/**
 * 外层“整段运行过程”折叠块**内部**的二次分段（09-23 双层折叠 —— 两个需求因此不再互斥）：
 *   外层 = 一整轮的过程（回合收尾皮肤「耗时 X · 统计」，默认收起 ⇒ **旧消息依旧只有一行**）；
 *   内层 = 外层展开后，夹在正文之间的每段过程各自再收成一个意图词小折叠块（图二的芯片）。
 *
 * ⛔ 这两层是**不同粒度**，不是“对同一批内容折两次”：外层管“整轮收不收”，内层管“这段过程说不说”。
 *    正文一律留在外面（内层只收过程），所以展开外层看到的是「正文 / 芯片 / 正文 / 芯片」。
 */
export function NestedProcessRuns({ units, renderUnit, waitingForApproval, failedCountOf }: {
  units: FoldUnit[];
  renderUnit: (unit: FoldUnit) => React.ReactNode;
  waitingForApproval?: boolean;
  failedCountOf: (group: FoldUnit[]) => number;
}) {
  const parts: { kind: "body" | "run"; units: FoldUnit[] }[] = [];
  let buffer: FoldUnit[] = [];
  const flush = () => { if (buffer.length) parts.push({ kind: "run", units: buffer }); buffer = []; };
  for (const unit of units) {
    if (unit.item.type === "agentMessage" && String(unit.item.text ?? "").trim()) {
      flush();
      parts.push({ kind: "body", units: [unit] });
      continue;
    }
    buffer.push(unit);
  }
  flush();
  // 整段里没有正文把它们切开 ⇒ 不必再包一层（外层已经把它收住了）
  if (!parts.some((part) => part.kind === "body")) {
    return <CappedToolSequence units={units} cap={false} renderUnit={renderUnit} />;
  }
  return <>{parts.map((part, index) => part.kind === "body"
    ? <Fragment key={`npr-body-${index}`}>{renderUnit(part.units[0])}</Fragment>
    : (
      <FoldGroup
        key={`npr-run-${index}`}
        variant="summary"
        /* 内层芯片：标题 = 意图摘要（同外层非首段口径）。
           ⛔ 右侧统计小字已按用户 09-23 要求删除（见 FoldGroup 处注释），不再传 stats。 */
        title={computeFoldSummary(part.units, false, waitingForApproval)}
        leadGroup={topToolGroup(part.units)}
        failedCount={failedCountOf(part.units) || undefined}
      >
        <CappedToolSequence units={part.units} cap={false} renderUnit={renderUnit} />
      </FoldGroup>
    ))}</>;
}

export type FoldHandlers = {
  onCopy: (text: string) => void;
  onQuote: (text: string) => void;
  onImageCopy: (path: string) => void;
  onFork: (turnId: string) => void;
  onEdit: (turnId: string, item: ThreadItem) => void;
  onOpenFile: (path: string) => void;
  onOpenThread?: (id: string) => void;
  /** 把（可能被用户改过的）计划作为一条用户消息交回 —— 计划可编辑构件的出口 */
  onApplyPlan?: (markdown: string) => void;
};

export function FoldGroup({ title, leadGroup, variant, running, defaultOpen = false, autoFold, failedCount, children }: {
  title: string;
  leadGroup?: string | null;
  variant: "summary" | "completed" | "process";
  running?: boolean;
  defaultOpen?: boolean;
  autoFold?: boolean;
  failedCount?: number;
  children: React.ReactNode;
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const [mountOpen] = useState(() => Boolean(autoFold));
  // 挂载帧保持展开，下一帧再收起 → 浏览器能捕捉到 1fr→0fr 的高度变化，高度过渡才跑得起来。
  // 依赖数组必须用 mountOpen 而不能用「已执行过」的 ref 去挡，StrictMode 下 effect 双调用会
  // 先取消 rAF 再被 ref 挡掉第二次调度，结果永远收不起来。
  useEffect(() => {
    if (!mountOpen) return;
    const raf = requestAnimationFrame(() => setManualOpen(false));
    return () => cancelAnimationFrame(raf);
  }, [mountOpen]);
  const open = manualOpen ?? (mountOpen || defaultOpen);
  const group = leadGroup ?? "other";
  const LeadIcon = group === "command" ? TerminalSquare
    : group === "modify" ? FileCode2
    : group === "research" || group === "search" ? Search
    : group === "collab" ? Bot
    : group === "reasoning" ? Brain
    : Wrench;
  return (
    <div className={`wb-fold ${open ? "open" : "collapsed"} wb-fold--${variant} ${running ? "running" : ""}`}>
      <button type="button" className="wb-fold-header" title={open ? "点击收起" : "点击展开过程"} onClick={() => setManualOpen(!open)}>
        {variant === "summary" && <span className="wb-fold-lead"><LeadIcon size={13} /></span>}
        {variant === "completed" && <span className={`wb-fold-dot ${failedCount ? "error" : ""}`} aria-hidden />}
        <span className={`wb-fold-title ${running ? "shimmer-text" : ""}`}>{title}</span>
        {/* 展开/收起箭头：**放在内容之后**，默认隐藏、悬停才显形（09-23 用户：
            「展开折叠图标动态展示在内容后面就行，鼠标放上去展示，不放上去默认隐藏，点击后可以展示」）。
            形态与显隐规则见 03-messages-turns.css 的 .wb-fold-caret。
            ⛔ 放在标题**之前**是旧形态（左对齐箭头），用户明确要求改到内容后面，别改回去。 */}
        <ChevronDown size={12} className="wb-fold-caret" />
        {/* ⛔⛔ 右侧概要统计小字已删（用户 09-23 附截图：「这些文字多余，全部删掉」）——
            即「调用服务 6 次、查看 4 次、深度思考 7 段」/「深度思考 1 段」那一列。
            ⚠️ 知情代价：**展开前看不到本段干了多少活**（这曾是用户 09-23 明确要过的能力，
            同一句话里被推翻）；分类纯函数 src/lib/tool-call-classify.mjs 仍保留，
            想加回来只需在这里补一个 <span className="wb-fold-stats">{stats}</span>。
            历史：09-20 删过「N 项失败」文字（失败由 .wb-fold-dot.error 表达），别再扩写文字。 */}
      </button>
      <Fold open={open} bare><div className="wb-fold-body">{children}</div></Fold>
    </div>
  );
}

export function TurnFoldStream({ items, turn, running, fallbackWindow, waitingForApproval, handlers, finalAgentId, usage, tokenUsage, keepProcessOpen }: {
  items: ThreadItem[];
  turn: Turn;
  running: boolean;
  fallbackWindow?: number;
  waitingForApproval?: boolean;
  handlers: FoldHandlers;
  finalAgentId?: string;
  usage?: any;
  tokenUsage?: any;
  /** 回合被用户主动停止时置真：过程组**默认展开**。
   *  ⛔ 用户 09-18「点停止后运行过程和内容要保持在，方便继续任务」—— 折叠成一行虽然内容没丢，
   *  但用户看不到"刚才做到哪了"，也没法顺着接着交代。所以停止的回合把过程摊开。 */
  keepProcessOpen?: boolean;
}) {
  const units = useMemo(() => items
    .filter((item) => !(item.type === "agentMessage" && !String(item.text ?? "").trim()))
    .map((item) => ({ item, kind: classifyUnit(item) })),
  [items]);
  const segments = useMemo(() => buildSegments(units, !running), [units, running]);

  const renderItem = (unit: FoldUnit, hideFooter?: boolean, reasoningActive?: boolean) => (
    <MemoItemView
      item={unit.item}
      turn={turn}
      turnActive={unit.item.type === "reasoning" ? Boolean(reasoningActive) : running}
      usage={unit.item.id === finalAgentId ? usage : null}
      tokenUsage={unit.item.id === finalAgentId ? tokenUsage : null}
      fallbackWindow={fallbackWindow}
      hideFooter={unit.item.type === "agentMessage" ? hideFooter || undefined : undefined}
      waitingForApproval={waitingForApproval}
      onCopy={handlers.onCopy}
      onQuote={handlers.onQuote}
      onImageCopy={handlers.onImageCopy}
      onFork={unit.item.type === "agentMessage" && unit.item.id === finalAgentId && !hideFooter ? () => handlers.onFork(turn.id) : undefined}
      onOpenFile={handlers.onOpenFile}
      onOpenThread={handlers.onOpenThread}
      onApplyPlan={handlers.onApplyPlan}
      key={unit.item.id}
    />
  );

  const failedCountOf = (group: FoldUnit[]) => group.filter((u) => foldItemStatus(u.item) === "failed" || (u.item.type === "commandExecution" && !running && u.item.exitCode)).length;

  // ⛔ 概要统计（`summarizeToolCalls`）的**展示**已按用户 09-23 要求整条删除：
  //   折叠头右侧那列小字「调用服务 6 次、查看 4 次、深度思考 7 段」/「深度思考 1 段」都不再渲染。
  //   纯函数 src/lib/tool-call-classify.mjs 保留（分类逻辑仍被预检【112】钉着，想恢复展示很方便）。
  //   别再顺手把它挂回折叠头 —— 用户原话「这些文字多余，全部删掉」。

  if (running) {
    // 运行态：正文、工具和多段深度思考按原始顺序逐项存在；各卡片自行完成 live→done。
    // ★ 09-23 用户：「运行过程中，正文中间工具调用没有在下一个正文内容出来后，自动折叠成
    //   运行完成态两个正文中间的效果」。⇒ 已经**被后续正文隔开**的那段过程（工具/已结束的
    //   思考）在运行中也要收成一个折叠块（autoFold 播收起动画），形态与完成态内层芯片一致；
    //   ⛔ 还在长、还在跑的**末段**保持内联（「同一工具 >3 条」那层是它唯一的收敛机制）——
    //   不能合进摘要，否则下一阶段的步骤到来时前一阶段会在视觉上消失（运行态老规矩）。
    const lastReasoningIndex = units.reduce((last, unit, index) => unit.item.type === "reasoning" ? index : last, -1);
    const indexByUnit = new Map(units.map((unit, index) => [unit, index] as const));
    const renderLiveUnit = (unit: FoldUnit) => {
      const index = indexByUnit.get(unit) ?? -1;
      // 上游有时不在 reasoning item 上回传 completed/status，只能用事件顺序兜底：
      // 后面已经出现工具或正文时，前一块思考必然已经结束；只有最后一个无完成标记
      // 的 reasoning 才是当前正在直播的思考。
      const reasoningActive = unit.item.type === "reasoning"
        && (unit.item.status === "inProgress" || unit.item.status === "running"
          || (!unit.item.status && !unit.item.durationMs && !reasoningDuration.has(String(unit.item.id)) && index === lastReasoningIndex))
        && !units.slice(index + 1).some((next) => next.item.type !== "reasoning");
      return renderItem(unit, unit.item.type === "agentMessage" ? true : undefined, reasoningActive);
    };
    return <>{segments.map((seg) => (seg.kind === "foldable" && seg.shouldFold)
      ? (
        <FoldGroup
          key={`fold-live-${seg.units[0].item.id}`}
          variant="summary"
          title={computeFoldSummary(seg.units, false, waitingForApproval)}
          leadGroup={topToolGroup(seg.units)}
          failedCount={failedCountOf(seg.units) || undefined}
          /* autoFold：挂载帧先展开、下一帧收起 ⇒ 1fr→0fr 的高度过渡跑得起来（不闪）。
              这段已被折叠块收住 ⇒ cap={false}，不再叠「同一工具 >3 条」那层。 */
          autoFold
        >
          <CappedToolSequence units={seg.units} cap={false} renderUnit={renderLiveUnit} />
        </FoldGroup>
      )
      : <CappedToolSequence key={`live-${seg.units[0]?.item.id ?? "tail"}`} units={seg.units} renderUnit={renderLiveUnit} />)}</>;
  }

  // ── 完成态：与流式态同构的分段折叠 ──
  // 复用 segments（回合结束后所有 foldable 段 shouldFold=true），输出与流式态相同的扁平
  // 结构、相同的 key（fold-首单元id / item id）→ 完成瞬间不重挂、动画不重播。
  // 与流式态的差异仅两点：
  //   1. 首个正文之前的工具段保留「已完成 · 用时 X」皮肤作为任务回合收尾标记；其余工具段
  //      用意图摘要标题（computeFoldSummary，如「已搜索：…」）——旧消息展开后正文之间也有
  //      运行状态展示，不再是一坨无结构的正文堆（旧版把正文+工具全塞进一个巨型已完成组）；
  //   2. 不播 autoFold：历史加载保持收起；刚完成的组在流式期已收起，无需重播。
  const duration = turn.durationMs ? formatDuration(turn.durationMs) : null;
  // ⛔ 回合结束时必须说清「为什么结束」（09-18 用户实测「跑长任务老是中途自动停止」，
  //   界面只有「处理出错」四个字，用户既不知道原因也不知道能不能接着跑）：
  //   引擎把原因写在 `turn.error`（`codexErrorInfo` 是分类枚举：contextWindowExceeded /
  //   sandboxError / rateLimitExceeded …）与 `status === "interrupted"`（真机实测
  //   `{status:"interrupted", error:null}` —— 旧实现走「耗时 Xs」分支，完全看不出被中断）上。
  //   分类标签进标题，完整原因（含处置建议）走下面的提示条 + 悬停。
  const stopReason = describeTurnStop(turn);
  const completedTitle = turnHeadline(turn, duration);
  // 完成事件并不总会给 agentMessage 带稳定 id（部分上游只在流式事件里有 id，
  // 最终快照会缺失或更换）。不能因此退回旧分段展示，否则思考和中间正文会全部
  // 暴露在“耗时”折叠外。优先匹配明确 id，匹配不到就以最后一条有正文的消息为总结。
  let finalUnitIndex = -1;
  if (finalAgentId) {
    for (let index = units.length - 1; index >= 0; index--) {
      if (units[index].item.id === finalAgentId && units[index].item.type === "agentMessage") {
        finalUnitIndex = index;
        break;
      }
    }
  }
  if (finalUnitIndex < 0) {
    for (let index = units.length - 1; index >= 0; index--) {
      const item = units[index].item;
      if (item.type === "agentMessage" && Boolean(String(item.text ?? "").trim())) {
        finalUnitIndex = index;
        break;
      }
    }
  }
  const finalUnit = finalUnitIndex >= 0 ? units[finalUnitIndex] : undefined;
  // ⛔ 长正文不许进折叠组（09-12 用户反馈「折叠消息把 codex 最后汇报的也折叠进去了」）。
  // 实测该会话 rollout 的条目序列：… AgentMessage(712字) → DynamicToolCall → Reasoning
  // → AgentMessage(80字)。「最终答复 = 最后一条有正文的消息」只挑中那条 80 字收尾，
  // 于是 712 字的**汇报本身**被当成过程收进了「耗时」折叠组（要点开才看得到）。
  // 现在按 planCompletedFold 排：长正文（≥ FOLD_BODY_ANCHOR_CHARS）与最终答复留在外面，
  // 只有夹在它们之间的过程（工具/思考/一句话过渡）才收进折叠组 ——
  // 即**整段运行过程收成一个折叠块**（旧消息靠它保持简短）。
  // ⛔ 09-23 试过把过渡正文也留在外面（每段正文之间各自成一个折叠块，对标图二），
  //    用户当天否掉：「你先加了一个正文中间折叠，运行过程不折叠吗」⇒ 别再试（见纯函数文件头）。
  if (finalUnit && units.length > 1) {
    const plan = planCompletedFold(units, finalUnit.item.id);
    if (plan.some((entry) => entry.kind === "fold")) {
      // ⛔ 09-15 修复「耗时折叠头重复」：任务回合（长正文把过程切成多段）原来**每个** fold 段
      // 都挂 completedTitle，实测一回合出现两个「耗时 4m49s · 2 项失败」——一个在过程开头、
      // 一个紧跟最终答复，用户当成「又在底部重新渲染了一遍/时长在变大」（相邻任务回合时长
      // 4m49s 与 4m55s 被误认成同一条在增长）。设计意图（见上方注释）是**每回合只有一个**
      // 收尾标记：第一个过程段（lead）挂回合收尾皮肤 + 回合总失败数，其余段用意图摘要标题。
      const leadFoldIndex = plan.findIndex((entry) => entry.kind === "fold");
      const turnFailedTotal = failedCountOf(units);
      return <>
        {plan.map((entry, index) => entry.kind === "fold"
          ? (
            <FoldGroup
              key={`fold-completed-${turn.id}-${index}`}
              variant={index === leadFoldIndex ? "completed" : "summary"}
              /* 非首段：标题用**意图摘要**（09-23 用户选定「收起那一行写意图词，如『运行命令』
                 『修改文件、运行命令：<目标>』」）。首段仍是回合收尾皮肤（耗时/停止原因）——
                 停止标记那边明确定过「耗时由过程组标题负责，同一屏只说一次」（守卫【50】）。
                 ⛔ 右侧统计小字已删（见 FoldGroup 处注释）。 */
              title={index === leadFoldIndex ? completedTitle : computeFoldSummary(entry.units, false, waitingForApproval)}
              leadGroup={topToolGroup(entry.units)}
              failedCount={(index === leadFoldIndex ? turnFailedTotal : failedCountOf(entry.units)) || undefined}
              defaultOpen={keepProcessOpen}
            >
              {/* 内层二次分段：外层整段收起保证旧消息简短；展开后正文之间的每段过程再各自
                  收成一个意图词芯片（图二口径）。cap={false}：芯片已负责收敛，
                  再叠「同一工具 >3 条」就是对同一批内容折两次（用户明确要求避免）。 */}
              <NestedProcessRuns
                units={entry.units}
                renderUnit={(unit) => renderItem(unit, unit.item.type === "agentMessage" ? true : undefined)}
                waitingForApproval={waitingForApproval}
                failedCountOf={failedCountOf}
              />
            </FoldGroup>
          )
          : renderItem(entry.unit, true))}
      </>;
    }
  }
  const out: React.ReactNode[] = [];
  let bodySeen = false;
  for (const seg of segments) {
    if (seg.kind === "foldable") {
      const lead = !bodySeen;
      out.push(
        <FoldGroup
          key={`fold-${seg.units[0].item.id}`}
          variant={lead ? "completed" : "summary"}
          /* 与 planCompletedFold 分支同口径：非首段标题 = 意图摘要（见那处注释，两条分支必须同时改） */
          title={lead ? completedTitle : computeFoldSummary(seg.units, false, waitingForApproval)}
          leadGroup={topToolGroup(seg.units)}
          failedCount={failedCountOf(seg.units) || undefined}
          defaultOpen={keepProcessOpen}
        >
          {/* 同 planCompletedFold 分支：外层折叠块独占"两条正文之间"的收敛，内层不再按 >3 条收一次 */}
          <CappedToolSequence units={seg.units} cap={false} renderUnit={(unit) => renderItem(unit, unit.item.type === "agentMessage" ? true : undefined)} />
        </FoldGroup>,
      );
      continue;
    }
    for (const u of seg.units) {
      if (u.kind === "body") bodySeen = true;
      // 与流式态同构：finalAgent 的 footer 永远不在 inner 渲染，由 TurnView 外层 MessageFooter 统一渲染。
      out.push(renderItem(u, u.item.type === "agentMessage" ? true : undefined));
    }
  }
  return <>{out}</>;
}

const MemoItemView = memo(ItemView, (prev, next) =>
  prev.item === next.item
  && prev.turnActive === next.turnActive
  && prev.usage === next.usage
  && prev.tokenUsage === next.tokenUsage
  && prev.waitingForApproval === next.waitingForApproval
  && prev.hideFooter === next.hideFooter
  && prev.fallbackWindow === next.fallbackWindow,
);
