/**
 * 「添加设置页」弹窗（10-30 用户：「做一个弹窗，搜索，批量选择功能」）。
 *
 * 只做选择：搜索过滤 + 勾选多个 + 一次提交；真正的写入由编辑器调 extensions:menu-set。
 * ⛔ 层级：编辑菜单是设置内弹窗档 900，本弹窗压在它上面但低于轻浮层（1000） ⇒ 950。
 * ⛔ 已在内置默认项 / 已添加的页面显示「已添加」且不可勾选（否则菜单里会出现两个「收藏夹」）。
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, Search, X } from "lucide-react";
import type { FunctionMenuSettingsTarget } from "./store";

type PageItem = { page: string; label: string; group: string };

export function AddPagesDialog({ targets, taken, remaining, onClose, onAdd }: {
  targets: FunctionMenuSettingsTarget[];
  /** 已经在内置默认项或自定义入口里的页面 —— 不再可选 */
  taken: Set<string>;
  /** 还允许再加多少条（主进程上限 40） */
  remaining: number;
  onClose: () => void;
  onAdd: (pages: PageItem[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      /* ⛔ 捕获阶段拦下：否则同一个 Esc 会把底下的「编辑拓展功能」一起关掉。 */
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const keyword = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const map = new Map<string, PageItem[]>();
    for (const item of targets) {
      if (keyword && !item.label.toLowerCase().includes(keyword) && !item.page.includes(keyword)) continue;
      if (!map.has(item.group)) map.set(item.group, []);
      map.get(item.group)!.push({ page: item.page, label: item.label, group: item.group });
    }
    return [...map.entries()];
  }, [targets, keyword]);

  const chosen = useMemo(
    () => [...selected].filter((page) => !taken.has(page)).slice(0, Math.max(0, remaining)),
    [selected, taken, remaining],
  );
  const byPage = useMemo(() => new Map(targets.map((item) => [item.page, item])), [targets]);
  const chosenItems = chosen.map((page) => byPage.get(page)).filter((item): item is PageItem => Boolean(item));
  const toggle = (page: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(page)) next.delete(page);
    else next.add(page);
    return next;
  });
  const onRowKey = (event: ReactKeyboardEvent<HTMLButtonElement>, page: string) => {
    if (event.key === " " || event.key === "Enter") { event.preventDefault(); toggle(page); }
  };

  return createPortal(
    <div className="fm-pages-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="fm-pages-dialog" role="dialog" aria-modal="true" aria-label="添加设置页">
        <header className="fm-pages-head">
          <div>
            <h3>添加设置页</h3>
            <p>勾选要放进「功能入口」的页面，可多选；添加后点一下就能跳到那一页。</p>
          </div>
          <button ref={closeRef} type="button" className="fm-pages-close" aria-label="关闭" onClick={onClose}><X size={16} /></button>
        </header>

        <label className="fm-pages-search">
          <Search size={14} />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索设置页（如 模型 / 记忆 / 快捷键）" />
          {query ? <button type="button" onClick={() => setQuery("")} aria-label="清空搜索"><X size={12} /></button> : null}
        </label>

        <div className="fm-pages-list">
          {groups.map(([group, items]) => (
            <section className="fm-pages-group" key={group}>
              <h4>{group}<small>{items.length}</small></h4>
              <div className="fm-pages-rows">
                {items.map((item) => {
                  const disabled = taken.has(item.page);
                  const on = selected.has(item.page) && !disabled;
                  return (
                    <button
                      key={item.page}
                      type="button"
                      className={`fm-pages-row ${on ? "on" : ""}`}
                      disabled={disabled}
                      aria-pressed={on}
                      title={disabled ? "已经在功能入口里了" : "勾选加入"}
                      onClick={() => toggle(item.page)}
                      onKeyDown={(event) => onRowKey(event, item.page)}
                    >
                      <span className="fm-pages-check">{on ? <Check size={11} /> : null}</span>
                      <span className="fm-pages-name">{item.label}</span>
                      <em>{disabled ? "已添加" : group}</em>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          {groups.length === 0 && <p className="fm-pages-empty">没有匹配的设置页</p>}
        </div>

        <footer className="fm-pages-foot">
          <span>
            已选 {chosen.length} 项
            {remaining <= 0 ? " · 已达上限 40" : selected.size > chosen.length ? ` · 超出的 ${selected.size - chosen.length} 项不会被添加` : ""}
          </span>
          <button type="button" className="secondary-setting" onClick={onClose}>取消</button>
          <button
            type="button"
            className="primary-setting"
            disabled={chosen.length === 0}
            onClick={() => {
              onAdd(chosenItems);
              onClose();
            }}
          >
            添加{chosen.length ? ` ${chosen.length} 项` : ""}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
