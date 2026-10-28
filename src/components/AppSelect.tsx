import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { placePopover } from "./AnchorPopover";

/**
 * 统一的自定义下拉框（09-28）：替代原生 `<select>`。
 *
 * ⛔ 为什么不用原生 select：系统默认的 option 弹层无法样式化 —— 蓝色高亮块、
 * 无圆角、长文本不截断（用户截图点名「太丑了」）。全仓 34 处原生 select 由本组件统一。
 *
 * 实现要点：
 *  - 弹层 **createPortal 到 body**：设置面板/弹窗的祖先链有 transform/contain 时，
 *    position:fixed 会退化成相对定位（09-28 弹窗事故同款坑）—— portal 对任何祖先免疫。
 *  - 定位**不再自己算**（10-28）：翻转 / 夹进视口 / 可用高度统一用 AnchorPopover 的
 *    `placePopover()` —— 这是全仓唯一实现，省得下拉框又是另一套"自己写的贴边逻辑"。
 *  - 键盘：Enter/Space/ArrowDown 打开，↑↓ 移动，Enter 选中，Esc/Tab 关闭。
 *  - 选项文本单行省略（title 给全文）—— 定时任务的会话清单里有超长 preview。
 */
export type AppSelectOption = { value: string; label: string; disabled?: boolean };

export function AppSelect({ value, onChange, options, ariaLabel, className, disabled, title }: {
  value: string;
  onChange: (value: string) => void;
  options: Array<AppSelectOption>;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  /** 悬停提示（触发按钮显示当前项的全文） */
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; maxHeight: number; anchorTop: number; openUp: boolean } | null>(null);

  const current = options.find((o) => o.value === value);

  const openList = () => {
    if (disabled) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    /* 定位统一走 placePopover（axis=y）：下方够放就往下、不够就翻上、另一轴夹进视口，
       可用高度由它按所选侧算 —— 本组件只负责"贴着触发按钮等宽"这一件事。 */
    const placed = placePopover(
      { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
      { w: r.width, h: Math.min(288, window.innerHeight - 24) },
      { axis: "y", gap: 4 },
    );
    setRect({
      left: placed.left,
      top: placed.top,
      width: placed.width,
      maxHeight: Math.min(288, placed.maxHeight),
      anchorTop: r.top,
      openUp: placed.side === "above",
    });
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  // 打开时滚动定位到当前项
  useLayoutEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); setOpen(false); btnRef.current?.focus(); return; }
      if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => Math.max(0, i - 1)); return; }
      if (event.key === "Home") { event.preventDefault(); setActive(0); return; }
      if (event.key === "End") { event.preventDefault(); setActive(options.length - 1); return; }
      if (event.key === "Enter") {
        event.preventDefault();
        const opt = options[active];
        if (opt && !opt.disabled) { onChange(opt.value); setOpen(false); btnRef.current?.focus(); }
        return;
      }
      if (event.key === "Tab") setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, active, options, onChange]);

  const pick = (opt: AppSelectOption) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    btnRef.current?.focus();
  };

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`app-select-trigger ${className ?? ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        title={title ?? current?.label}
        onClick={(event) => { event.stopPropagation(); if (open) setOpen(false); else openList(); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" && !open) { event.preventDefault(); openList(); }
        }}
      >
        <span className="app-select-value">{current?.label ?? ""}</span>
        <svg className={`app-select-caret${open ? " is-open" : ""}`} width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && rect && createPortal(
        <>
          {/* 全屏透明遮罩：点外面关闭（比 document 监听可靠，且不用管 stopPropagation） */}
          <div className="app-select-overlay" onPointerDown={() => setOpen(false)} />
          <div
            className="app-select-list"
            role="listbox"
            aria-label={ariaLabel}
            ref={listRef}
            style={rect.openUp
              /* 向上开：仍以触发按钮**底边**为锚（面板底贴按钮上沿），高度由 placePopover 给的可用值封顶 */
              ? { left: rect.left, width: rect.width, bottom: window.innerHeight - rect.anchorTop + 4, maxHeight: rect.maxHeight }
              : { left: rect.left, top: rect.top, width: rect.width, maxHeight: rect.maxHeight }}
          >
            {options.map((opt, idx) => (
              <div
                key={opt.value || `__idx_${idx}`}
                data-idx={idx}
                role="option"
                aria-selected={opt.value === value}
                aria-disabled={opt.disabled || undefined}
                className={`app-select-option${idx === active ? " is-active" : ""}${opt.value === value ? " is-selected" : ""}${opt.disabled ? " is-disabled" : ""}`}
                title={opt.label}
                onPointerEnter={() => setActive(idx)}
                onClick={(event) => { event.stopPropagation(); pick(opt); }}
              >
                <span className="app-select-option-label">{opt.label}</span>
                {opt.value === value ? <Check size={13} className="app-select-check" /> : null}
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
