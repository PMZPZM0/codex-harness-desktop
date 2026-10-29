/** 会话内卡片（工具/动作/ capped 序列）（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { memo, useMemo, useRef, useState, useCallback, useLayoutEffect, Fragment } from "react";
import { useCardOpen, CardStatusIcon } from "../../components/CardShell";
import type { ActionStatus } from "../../components/CardShell";
import { ChevronDown, Wrench } from "lucide-react";
import { Fold } from "../shared/Fold";
import { DIFF_LINE_HEIGHT } from "../../lib/diff-line-height";
import { DIFF_OVERSCAN } from "../../lib/diff-overscan";
import { buildOrderedToolRuns } from "../../lib/turn-fold";
import type { FoldUnit } from "../../lib/turn-fold";

export function HookBadge({ hooks }: { hooks: { name: string; label?: string; done: boolean }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="hook-badge-wrap" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span className={`hook-badge ${hooks.every((h) => h.done) ? "done" : "running"}`} title="本回合注入的 Hook"><Wrench size={12} />{hooks.length}</span>
      {open && (
        <span className="hook-badge-pop">
          {hooks.map((hook) => <span className="hook-badge-row" key={hook.name} title={hook.name}><span className={`hook-dot ${hook.done ? "ok" : ""}`} />{hook.label ?? hook.name}</span>)}
        </span>
      )}
    </span>
  );
}

export type ToolStatusEntry = { id: string; name: string; scope: "computer" | "browser"; version: string; installed: boolean; binaryReady: boolean; detail: string; command: string };

export function ActionCard({ icon, verb, target, subtitle, info, status, statusText, autoOpen, defaultExpanded, children }: {
  icon: React.ReactNode;
  verb: React.ReactNode;
  /** 折叠行上的**短目标**（10-22 用户：「读取/编辑这类精确到文件，不要地址」）——文件名/查询词，
   *  ⛔ 完整路径与入参只进 `info`（展开体）。 */
  target?: React.ReactNode;
  /** 表头**第二行**的一句话（10-29 技能卡需要「这个技能是干什么的」常驻可见）。
   *  ⛔ 只放**人话**（中文说明），别把命令原文/地址塞回来 —— 那是 10-22 已经否掉的形态；
   *     给了 subtitle 表头就变两行（`.action-head.has-sub`），单行卡完全不受影响。 */
  subtitle?: React.ReactNode;
  info?: React.ReactNode;
  status: ActionStatus;
  statusText?: React.ReactNode;
  autoOpen?: boolean;
  defaultExpanded?: boolean;
  children?: React.ReactNode;
}) {
  const { open, toggle } = useCardOpen(Boolean(defaultExpanded || autoOpen));
  /* ★ 10-22 用户要求（对话框里的操作按钮：「读取/编辑/查看这类统一显示中文，不再显示地址和耗时，
     点击展开看详细内容」+「精确到文件，不要再地址」）：
       表头 = **图标 + 中文动作 + 文件名 + 状态图标 + 展开/收起**；
       `info`（完整路径 / 工具名 / 入参）搬进展开体，耗时由调用方决定要不要给（默认不给）。
     ⛔ 展开体从此是唯一的详情入口 ⇒ 只要有 info 就必须可点开（此前没有 children 的卡点了没反应）；
     ⛔ 没有 info 也没有 children 的卡（等待 / Hook）不画展开标识 —— 点了什么都不出来的箭头是骗子。 */
  const hasBody = info != null || children != null;
  const head = (
    <>
      <span className="action-row">
        <span className="action-icon">{icon}</span>
        <span className="action-verb">{verb}</span>
        {target != null && <span className="action-target">{target}</span>}
        <span className="action-status">
          <CardStatusIcon status={status} />
          {statusText != null && <span className="action-status-text">{statusText}</span>}
        </span>
        {hasBody && (
          /* ★ 10-22 用户：「『展开』字样不要，鼠标放上去再浮出箭头，移开就隐藏」
             ⛔ 不要再写回文案；展开态靠 aria-expanded + 箭头方向表达。 */
          <span className="action-toggle" aria-hidden="true">
            <ChevronDown size={13} className="action-chevron" />
          </span>
        )}
      </span>
      {/* 第二行（10-29）：只有给了 subtitle 才渲染；单行卡的表头结构因此一字未变。 */}
      {subtitle != null && <span className="action-sub">{subtitle}</span>}
    </>
  );
  return (
    <div className={`action-card ${status} ${open ? "open" : "closed"}`}>
      {hasBody
        ? <button type="button" className={`action-head ${subtitle != null ? "has-sub" : ""}`} onClick={toggle} aria-expanded={open}>{head}</button>
        : <div className={`action-head static ${subtitle != null ? "has-sub" : ""}`}>{head}</div>}
      {hasBody && (
        <Fold open={open}>
          <div className="action-content">
            {info != null && <div className="action-meta">{info}</div>}
            {children}
          </div>
        </Fold>
      )}
    </div>
  );
}

export const VirtualDiffLines = memo(function VirtualDiffLines({ text, maxHeight, fontSize, fontFamily }: { text: string; maxHeight: number; fontSize: number | string; fontFamily: string }) {
  const lines = useMemo(() => text.split("\n"), [text]);
  const boxRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState(() => ({ start: 0, end: Math.min(lines.length, 120) }));
  const recompute = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const first = Math.max(0, Math.floor(el.scrollTop / DIFF_LINE_HEIGHT) - DIFF_OVERSCAN);
    const count = Math.ceil((el.clientHeight || maxHeight) / DIFF_LINE_HEIGHT) + DIFF_OVERSCAN * 2;
    const end = Math.min(lines.length, first + count);
    setRange((current) => (current.start === first && current.end === end ? current : { start: first, end }));
  }, [lines.length, maxHeight]);
  useLayoutEffect(() => { recompute(); }, [recompute]);
  const rows = [];
  for (let i = range.start; i < range.end; i++) {
    const line = lines[i] ?? "";
    const kind = /^(\+\+\+|---)/.test(line) ? "meta" : line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
    rows.push(<div key={i} className={`virtual-diff-line ${kind}`} style={{ transform: `translateY(${i * DIFF_LINE_HEIGHT}px)` }}>{line || " "}</div>);
  }
  return (
    <div
      ref={boxRef}
      className="virtual-diff tool-code-pre"
      style={{ maxHeight, fontSize, fontFamily }}
      onScroll={recompute}
      data-total-lines={lines.length}
    >
      <div className="virtual-diff-inner" style={{ height: lines.length * DIFF_LINE_HEIGHT }}>{rows}</div>
    </div>
  );
});

export function CappedToolRun({ label, units, renderUnit, renderAfter, limit = 3 }: {
  label: string;
  units: FoldUnit[];
  renderUnit: (unit: FoldUnit) => React.ReactNode;
  /** 每项之后追加渲染（运行中实时「编辑」行按锚点挂在对应项后面——10-06）。 */
  renderAfter?: (unit: FoldUnit) => React.ReactNode;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  // 「同一工具连续调用超过 limit 条 ⇒ 只留最新 limit 条，较早的收进折叠行」。
  // ⚠️ 调用方传 limit=Infinity 时这里不会收起旧行（`hiddenCount` 恒 0 直接返回原序列）。
  const hiddenCount = Math.max(0, units.length - limit);
  const withTail = (unit: FoldUnit) => (
    <Fragment key={unit.item.id}>
      {renderUnit(unit)}
      {renderAfter ? renderAfter(unit) : null}
    </Fragment>
  );
  if (!hiddenCount) return <>{units.map(withTail)}</>;
  const hidden = units.slice(0, hiddenCount);
  const latest = units.slice(hiddenCount);
  return (
    <div className={`capped-tool-run ${expanded ? "expanded" : "collapsed"}`}>
      <button type="button" className="capped-tool-toggle" onClick={() => setExpanded((value) => !value)} title={expanded ? `收起较早的${label}` : `展开较早的${label}`}>
        <ChevronDown size={12} />
        <span>{expanded ? `收起较早的 ${hiddenCount} 条${label}` : `已收起 ${hiddenCount} 条${label}`}</span>
        {!expanded && <small>最新 {limit} 条</small>}
      </button>
      <Fold open={expanded}><div className="capped-tool-hidden">{hidden.map(withTail)}</div></Fold>
      <div className="capped-tool-latest">{latest.map(withTail)}</div>
    </div>
  );
}

/** 工具序列。
 *  `cap`（默认 true）= 是否启用「同一工具连续超过 3 条就收起较早的」这一层截断。
 *  ⛔ 完成态的**过程折叠块**必须传 `cap={false}`：那里外层折叠块（两条正文之间的全部过程）
 *    已经把整段收成一个可展开区块，再叠一层「已收起 N 条」就是**对同一批内容折两次** ——
 *    用户明确要求避免这种重复；而且停止回合（`keepProcessOpen`）外层默认展开时，内层仍收着会让
 *    「点开也看不到做到哪了」（09-18 修过的老问题）复活。
 *  ⛔ 运行态没有外层折叠块 ⇒ 保持 `cap` 开启，它是那一阶段唯一的收敛机制（两种规则各管一段、不重叠）。 */
export function CappedToolSequence({ units, renderUnit, renderAfter, cap = true, unitLimit }: {
  units: FoldUnit[];
  renderUnit: (unit: FoldUnit) => React.ReactNode;
  /** 每项之后追加渲染（运行中实时「编辑 <文件> +N -M」行按锚点挂在对应项后面——10-06 二改）。 */
  renderAfter?: (unit: FoldUnit) => React.ReactNode;
  cap?: boolean;
  /** 直播**过程末段**的整段上限（10-20）：超过就只留最新 N 条，其余收进「已收起…过程」。
   *  ⛔ 只传 foldable 段（工具/命令/编辑/搜索/看图/已结束思考），⛔ 别传给含正文的 normal 段
   *     —— 那会把助手正文也藏起来。 */
  unitLimit?: number;
}) {
  const runs = useMemo(() => (cap ? buildOrderedToolRuns(units) : []), [units, cap]);
  if (cap === false) return <>{units.map((unit) => <Fragment key={unit.item.id}>{renderUnit(unit)}{renderAfter ? renderAfter(unit) : null}</Fragment>)}</>;
  /* 直播末段没有外层折叠组 ⇒ 除了「同一工具 >3 条」之外，还要有一个**整段上限**：
     否则十分钟的回合里几十种不同工具/命令/看图会一直堆在折叠外（用户 10-20 审查报障）。 */
  if (unitLimit && units.length > unitLimit) {
    return <CappedToolRun label="过程" units={units} renderUnit={renderUnit} renderAfter={renderAfter} limit={unitLimit} />;
  }
  return <>{runs.map((run) => run.kind === "unit"
    ? <Fragment key={run.key}>{renderUnit(run.units[0])}{renderAfter ? renderAfter(run.units[0]) : null}</Fragment>
    : <CappedToolRun key={run.key} label={run.label} units={run.units} renderUnit={renderUnit} renderAfter={renderAfter} />)}</>;
}
