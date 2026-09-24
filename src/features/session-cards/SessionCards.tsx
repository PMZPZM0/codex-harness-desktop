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

export function ActionCard({ icon, verb, info, status, statusText, autoOpen, defaultExpanded, children }: {
  icon: React.ReactNode;
  verb: React.ReactNode;
  info?: React.ReactNode;
  status: ActionStatus;
  statusText?: React.ReactNode;
  autoOpen?: boolean;
  defaultExpanded?: boolean;
  children?: React.ReactNode;
}) {
  const { open, toggle } = useCardOpen(Boolean(defaultExpanded || autoOpen));
  return (
    <div className={`action-card ${status} ${open ? "open" : "closed"}`}>
      <button type="button" className="action-head" onClick={toggle}>
        <span className="action-icon">{icon}</span>
        <span className="action-verb">{verb}</span>
        {info != null && <span className="action-info">{info}</span>}
        <span className="action-status">
          <CardStatusIcon status={status} />
          {statusText != null && <span className="action-status-text">{statusText}</span>}
        </span>
        <ChevronDown size={13} className="action-chevron" />
      </button>
      {children != null && <Fold open={open}><div className="action-content">{children}</div></Fold>}
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

export function CappedToolRun({ label, units, renderUnit, limit = 3 }: {
  label: string;
  units: FoldUnit[];
  renderUnit: (unit: FoldUnit) => React.ReactNode;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  // 「同一工具连续调用超过 limit 条 ⇒ 只留最新 limit 条，较早的收进折叠行」。
  // ⚠️ 调用方传 limit=Infinity 时这里不会收起旧行（`hiddenCount` 恒 0 直接返回原序列）。
  const hiddenCount = Math.max(0, units.length - limit);
  if (!hiddenCount) return <>{units.map(renderUnit)}</>;
  const hidden = units.slice(0, hiddenCount);
  const latest = units.slice(hiddenCount);
  return (
    <div className={`capped-tool-run ${expanded ? "expanded" : "collapsed"}`}>
      <button type="button" className="capped-tool-toggle" onClick={() => setExpanded((value) => !value)} title={expanded ? `收起较早的${label}` : `展开较早的${label}`}>
        <ChevronDown size={12} />
        <span>{expanded ? `收起较早的 ${hiddenCount} 条${label}` : `已收起 ${hiddenCount} 条${label}`}</span>
        {!expanded && <small>最新 {limit} 条</small>}
      </button>
      <Fold open={expanded}><div className="capped-tool-hidden">{hidden.map(renderUnit)}</div></Fold>
      <div className="capped-tool-latest">{latest.map(renderUnit)}</div>
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
export function CappedToolSequence({ units, renderUnit, cap = true }: {
  units: FoldUnit[];
  renderUnit: (unit: FoldUnit) => React.ReactNode;
  cap?: boolean;
}) {
  const runs = useMemo(() => (cap ? buildOrderedToolRuns(units) : []), [units, cap]);
  if (cap === false) return <>{units.map(renderUnit)}</>;
  return <>{runs.map((run) => run.kind === "unit"
    ? <Fragment key={run.key}>{renderUnit(run.units[0])}</Fragment>
    : <CappedToolRun key={run.key} label={run.label} units={run.units} renderUnit={renderUnit} />)}</>;
}
