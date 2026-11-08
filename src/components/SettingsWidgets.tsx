import type { ReactNode } from "react";
import { Search, X } from "lucide-react";

/** 设置页通用控件：插件页与技能页共用，保证两页的筛选、批量操作、开关观感一致。 */

type SegmentedTabsOption = { value: string; label: string; count?: number };
/** 分段标签切换（role=tablist，选中态由 value 决定）。 */
export function SegmentedTabs({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: SegmentedTabsOption[] }) {
  return (
    <div className="segmented-tabs" role="tablist">
      {options.map((option) => (
        <button key={option.value} type="button" role="tab" aria-selected={option.value === value} className={option.value === value ? "active" : ""} onClick={() => onChange(option.value)}>
          <span>{option.label}</span>
          {typeof option.count === "number" && <em>{option.count}</em>}
        </button>
      ))}
    </div>
  );
}

/**
 * 工具条里的「视图切换」—— 设置页所有分页切换的**唯一**入口（MCP / 插件 / 专家市场共用）。
 *
 * ⛔⛔ 11-08 用户：「这上面一排按键，展示方式怎么总是变动，能不能统一一下」。根因是同一套分页
 *   在四个页面各写了一遍容器，尺寸各覆盖一次（实测同时存在 26/10px/11.5px、28/11px/12px、
 *   28/9px/12px 三种），`margin-left:auto` 也有两处各自生效 ⇒ 切分页时按钮会换位置、换大小。
 *   ⇒ 一律用本组件：容器类 `.settings-view-tabs`（尺寸只写在 `.settings-view-tabs .segmented-tabs button` 一处），
 *     位置只由它吃 `margin-left:auto`（同一行的操作组 ⛔ 不许再写 auto）。
 * ⛔ 想让某个页面特殊一点，改 `className` 传语义类，**别在页面里另写一套 SegmentedTabs**。
 */
export function ViewTabs({ value, onChange, options, className }: {
  value: string;
  onChange: (value: string) => void;
  options: SegmentedTabsOption[];
  className?: string;
}) {
  return (
    <div className={className ? `settings-view-tabs ${className}` : "settings-view-tabs"}>
      <SegmentedTabs value={value} onChange={onChange} options={options} />
    </div>
  );
}

/** 搜索框：带图标与一键清除，Esc 也能清空；空态不显示清除按钮，避免占位跳动 */
export function SearchField({
  value,
  onChange,
  placeholder,
  width,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: number;
}) {
  return (
    <div className="search-field" style={width ? { width } : undefined}>
      <Search size={14} className="search-field-icon" />
      <input
        value={value}
        spellCheck={false}
        placeholder={placeholder ?? "搜索"}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
      />
      {value ? (
        <button type="button" className="search-field-clear" title="清除搜索" aria-label="清除搜索" onClick={() => onChange("")}>
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
}

/** 勾选框内部的对勾：手写 SVG，避免为 12px 的图标多引入一个组件 */
function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden focusable="false">
      <path d="M2.5 6.2 4.7 8.4 9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 卡片勾选框：批量操作只作用于勾选的条目，没勾的不会被波及 */
export function CheckCard({
  checked,
  disabled,
  label,
  title,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label?: string;
  title?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label ?? "选择"}
      title={title ?? (checked ? "取消选择" : "勾选此项，纳入批量操作")}
      className={`check-card ${checked ? "on" : "off"} ${disabled ? "disabled" : ""}`}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
    >
      <span className="check-card-box">{checked ? <CheckIcon /> : null}</span>
    </button>
  );
}

/**
 * 全选控件：三态（全选 / 半选 / 未选）。
 * total 传的是「当前可勾选的数量」，真正参与批量的是勾选集合，而不是 total。
 */
export function SelectAllToggle({
  total,
  selected,
  onSelectAll,
  onClear,
  unit = "项",
}: {
  total: number;
  selected: number;
  onSelectAll: () => void;
  onClear: () => void;
  unit?: string;
}) {
  const all = total > 0 && selected === total;
  const some = selected > 0 && selected < total;
  const state = all ? "on" : some ? "partial" : "off";
  return (
    <div className="select-all">
      <button
        type="button"
        role="checkbox"
        aria-checked={all ? "true" : some ? "mixed" : "false"}
        className={`check-card ${state} ${total === 0 ? "disabled" : ""}`}
        disabled={total === 0}
        title={all ? "取消全选" : `全选当前 ${total} ${unit}可操作条目`}
        onClick={() => (all ? onClear() : onSelectAll())}
      >
        <span className="check-card-box">{all ? <CheckIcon /> : some ? <span className="check-dash" /> : null}</span>
      </button>
      <span className="select-all-text">
        {selected > 0 ? (
          <>已选 <strong>{selected}</strong> / {total} {unit}</>
        ) : (
          <>共 {total} {unit}可勾选</>
        )}
      </span>
      {selected > 0 && (
        <button type="button" className="select-all-clear" title="清空选择" onClick={onClear}>
          清空
        </button>
      )}
    </div>
  );
}

type BatchAction = {
  label: string;
  icon?: ReactNode;
  tone?: "primary" | "danger" | "default";
  disabled?: boolean;
  busy?: boolean;
  title?: string;
  onClick: () => void;
};
/** 批量操作条：左侧一句提示 + 右侧一组按钮。 */
export function BatchActions({ hint, actions }: { hint?: string; actions: BatchAction[] }) {
  return (
    <div className="batch-actions">
      {hint && <span className="batch-hint">{hint}</span>}
      <div className="batch-buttons">
        {actions.map((action, index) => (
          <button
            key={`${action.label}-${index}`}
            type="button"
            className={action.tone === "danger" ? "danger" : action.tone === "default" ? "default" : "primary"}
            disabled={action.disabled || action.busy}
            title={action.title}
            onClick={action.onClick}
          >
            {action.busy ? <span className="batch-spinner" aria-hidden /> : action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 开关：label 只作无障碍标签，不额外渲染文字，避免卡片头部被撑宽 */
export function ToggleSwitch({
  checked,
  disabled,
  label,
  title,
  className,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label?: string;
  title?: string;
  /** 附加类（布局钩子，如 acct-switch 的 margin-left:auto） */
  className?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ?? (checked ? "停用" : "启用")}
      title={title ?? (checked ? "点击停用" : "点击启用")}
      className={`toggle-switch ${checked ? "on" : "off"} ${disabled ? "disabled" : ""} ${className ?? ""}`}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
    >
      <span className="toggle-track"><span className="toggle-thumb" /></span>
    </button>
  );
}
