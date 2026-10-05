/**
 * memory-ui —— **基础组件层**（10-05）。
 *
 * ⛔ 设计原则（用户要求「风格高级、现代、简约、清晰的视觉层次、统一设计语言」）：
 * ① **颜色不承载唯一信息**：每处颜色都配文字或图标（色觉障碍可读）。
 * ② **层次靠留白与字重，不靠重边框**：三级 = 区块标题 / 条目标题 / 正文。
 * ③ **一个 token 源**：全部用项目既有的 `--bg/--panel/--text/--muted/--accent`，
 *    ⛔ 不在本文件写死颜色 ⇒ 深浅色主题自动跟随（项目已在 01-base 定义两套）。
 * ④ **零业务逻辑**：这些组件⛔ 不知道"记忆"是什么，只管布局与状态。
 *    ⇒ 新增第八类记忆时**不需要碰这个文件**。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Inbox, Loader2 } from "lucide-react";

/* ══ ① 外壳：区块 ══════════════════════════════════════════════════════ */

export function MemorySection({
  title, hint, icon, stat, tools, children, defaultOpen = true, dense,
}: {
  title: string;
  /** ⛔ 一句话说清"这一类记忆谁能看到"—— 用户判断能不能信它的依据 */
  hint?: string;
  icon?: ReactNode;
  /** 标题右侧的统计（⛔ 传数组而不是拼字符串：让排版由组件统一管） */
  stat?: { label: string; value: string | number; hint?: string }[];
  tools?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  dense?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`mui-section${open ? "" : " is-collapsed"}${dense ? " is-dense" : ""}`}>
      <header className="mui-section-head">
        <button type="button" className="mui-section-toggle" onClick={() => setOpen((v) => !v)}
          aria-expanded={open} title={open ? "收起" : "展开"}>
          <span className="mui-chevron">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
          {icon ? <span className="mui-section-icon">{icon}</span> : null}
          <span className="mui-section-title">{title}</span>
        </button>
        {hint && <span className="mui-section-hint">{hint}</span>}
        {!!stat?.length && (
          <span className="mui-section-stat">
            {stat.map((s) => (
              <span key={s.label} className="mui-stat" title={s.hint}>
                <span className="mui-stat-value">{s.value}</span>
                <span className="mui-stat-label">{s.label}</span>
              </span>
            ))}
          </span>
        )}
        {tools && <span className="mui-section-tools">{tools}</span>}
      </header>
      {open && <div className="mui-section-body">{children}</div>}
    </section>
  );
}

/* ══ ② 状态：加载 / 空 / 错误（⛔ 统一口径，各视图不各写一套）═══════════ */

export function MemoryState({ state, error, empty, onRetry, emptyHint }: {
  state: "idle" | "loading" | "ready" | "error";
  error?: string;
  /** ⛔ 空态文案要说清"为什么空"，⛔ 不许只写"暂无数据" */
  empty: string;
  emptyHint?: string;
  onRetry?: () => void;
}) {
  if (state === "loading") {
    return (
      <div className="mui-state" role="status" aria-live="polite">
        <Loader2 size={16} className="mui-spin" />
        <span>正在读取…</span>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="mui-state is-error" role="alert">
        <AlertTriangle size={16} />
        <span>{error || "读取失败"}</span>
        {onRetry && <button type="button" className="mui-retry" onClick={onRetry}>重试</button>}
      </div>
    );
  }
  return (
    <div className="mui-state is-empty">
      <Inbox size={16} />
      <span>{empty}</span>
      {emptyHint && <small>{emptyHint}</small>}
    </div>
  );
}

/** 骨架屏：⛔ 比转圈更有用（用户知道"马上会有内容、几行"）。 */
export function MemorySkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="mui-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="mui-skeleton-row" style={{ opacity: 1 - i * 0.16 }} />
      ))}
    </div>
  );
}

/* ══ ③ 小组件 ══════════════════════════════════════════════════════════ */

export function MemoryBadge({ tone = "neutral", children, title }: {
  /** ⛔ tone 只影响**装饰**，⛔ 语义永远由 children 的文字承担 */
  tone?: "neutral" | "accent" | "success" | "warn" | "danger";
  children: ReactNode;
  title?: string;
}) {
  return <span className={`mui-badge tone-${tone}`} title={title}>{children}</span>;
}

export function MemoryTag({ children, title }: { children: ReactNode; title?: string }) {
  return <span className="mui-tag" title={title}>{children}</span>;
}

/** 权重条：⛔ 数值 + 条形双编码（⛔ 不靠长度单独表意） */
export function MemoryWeight({ value, label = "权重" }: { value: number; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <span className="mui-weight" title={`重要性 ${value.toFixed(2)} —— 影响注入顺序，被裁剪时最后被淘汰`}>
      <span className="mui-weight-bar" aria-hidden><i style={{ width: `${pct}%` }} /></span>
      <span className="mui-weight-text">{label} {value.toFixed(2)}</span>
    </span>
  );
}

/** 相对时间：⛔ 统一口径（全应用一致），⛔ 超过 30 天给绝对日期（相对时间没意义了）。 */
export function MemoryTime({ ts, prefix }: { ts: number; prefix?: string }) {
  const d = Math.max(0, Date.now() - ts);
  const text =
    d < 60_000 ? "刚刚"
    : d < 3_600_000 ? `${Math.floor(d / 60_000)} 分钟前`
    : d < 86_400_000 ? `${Math.floor(d / 3_600_000)} 小时前`
    : d < 30 * 86_400_000 ? `${Math.floor(d / 86_400_000)} 天前`
    : new Date(ts).toLocaleDateString("zh-CN");
  return <time className="mui-time" dateTime={new Date(ts).toISOString()} title={new Date(ts).toLocaleString()}>{prefix ? `${prefix} ` : ""}{text}</time>;
}

/* ══ ④ 虚拟列表（⛔ 长列表性能：大量会话时只渲染可视区）════════════════ */

/**
 * 轻量虚拟列表：固定行高、按可视窗口切片。
 * ⛔ 为什么自己写而不引库：行高固定 + 无动态测量 ≈ 40 行就够，
 *    引一个虚拟列表库会给打包体积和升级面都添成本（这个项目对依赖敏感）。
 * ⛔ 上限保护：超过 `maxRender` 就只渲染前 maxRender 条 + 一条"还有 N 条"的提示
 *    （虚拟化在 Electron 窗口里收益有限，**上限保护**才是真收益）。
 */
/**
 * 轻量虚拟列表。
 *
 * ⛔⛔ **不假设行高**（第一版按固定 rowHeight 切，探针立刻抓到"统计 20 条、只看见 6 条"
 *   —— 内容实际比设定值高，被裁掉了）。⇒ 改成**先渲染一屏测真实高度**，
 *   再用它算窗口。条目内容长度不可控（记忆正文可长可短），固定行高必然出错。
 * ⛔ 上限保护仍在：超过 maxRender 只渲染前 N 条 + 明示"还有多少"
 *   （虚拟化在 Electron 窗口里收益有限，**上限保护**才是真收益）。
 */
export function MemoryList<T>({ items, estimateRow = 88, maxRender = 300, renderItem, keyOf, empty }: {
  items: T[];
  /** ⛔ 估算行高（仅首屏用，测准后改用实测值） */
  estimateRow?: number;
  maxRender?: number;
  renderItem: (item: T, index: number) => ReactNode;
  keyOf: (item: T, index: number) => string;
  empty?: ReactNode;
}) {
  const [rowH, setRowH] = useState(estimateRow);
  const [viewport, setViewport] = useState(600);
  const [scrollTop, setScrollTop] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const measured = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ⛔ 首屏渲染完量一次真实行高：取前 3 行的高度中位数（⛔ 中位数比均值抗异常值）。 */
  useEffect(() => {
    if (measured.current || !items.length) return;
    const rows = ref.current?.querySelectorAll<HTMLElement>(".mui-list-row");
    if (!rows || rows.length < 1) return;
    const heights = [...rows].slice(0, 3).map((r) => r.getBoundingClientRect().height).filter((h) => h > 0);
    if (!heights.length) return;
    heights.sort((a, b) => a - b);
    const median = heights[Math.floor(heights.length / 2)];
    if (median > 8) { setRowH(Math.ceil(median)); measured.current = true; }
  }, [items.length]);

  const capped = useMemo(() => items.slice(0, maxRender), [items, maxRender]);
  const start = Math.max(0, Math.floor(scrollTop / rowH) - 2);
  const count = Math.ceil(viewport / rowH) + 4;
  const slice = capped.slice(start, start + count);

  if (!items.length) return <>{empty}</>;

  return (
    <div className="mui-list" ref={ref} onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}>
      <div style={{ height: capped.length * rowH, position: "relative" }}>
        <div style={{ transform: "translateY(" + start * rowH + "px)" }}>
          {slice.map((item, i) => (
            <div key={keyOf(item, start + i)} className="mui-list-row">
              {renderItem(item, start + i)}
            </div>
          ))}
        </div>
      </div>
      {items.length > maxRender && (
        <p className="mui-list-more">
          为保持流畅只渲染了前 {maxRender} 条（共 {items.length} 条）—— 用搜索或筛选缩小范围。
        </p>
      )}
    </div>
  );
}
