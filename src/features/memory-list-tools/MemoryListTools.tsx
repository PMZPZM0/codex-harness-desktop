/**
 * 四个记忆板块共用的「搜索 / 筛选 / 批量管理」工具条（11-11 独立板块）。
 *
 * ⛔ 拓展接口（新增第五个记忆板块时只改调用方，不动这里）：
 *   · filters：任意个下拉筛选，值/选项由调用方给（会话状态、条目类型、作用域、归属群…）
 *   · actions：任意个批量动作，每个动作自带 confirmText 与 run(ids)
 *   · visibleIds：只用来做「全选当前可见」，⛔ 不跨筛选误选看不见的行
 *
 * ⛔ 破坏性动作一律页内二次确认（role=alertdialog），不弹系统 confirm；
 *    ⛔ 不靠 disabled 表达归属（busy 时的 disabled 只是防重复提交）。
 */
import { useState } from "react";
import { Search } from "lucide-react";
import { AppSelect } from "../../components/AppSelect";
import { toggleSelection } from "../../lib/memory-list-filter.mjs";

export type MemoryListFilter = {
  key: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
};

export type MemoryListAction = {
  key: string;
  label: string;
  danger?: boolean;
  confirmText: (count: number) => string;
  run: (ids: string[]) => Promise<void>;
};

/** 记忆列表工具条：搜索 + 筛选 + 全选 + 批量动作 + 二次确认（四个板块共用同一份）。 */
export function MemoryListTools({
  query, onQueryChange, placeholder = "搜名称或 ID",
  filters = [], visibleIds = [], selected = [], onSelectionChange, actions = [], summary,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder?: string;
  filters?: MemoryListFilter[];
  visibleIds?: string[];
  selected?: string[];
  onSelectionChange: (ids: string[]) => void;
  actions?: MemoryListAction[];
  summary?: string;
}) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = actions.find((a) => a.key === pendingKey) ?? null;
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));

  const confirm = async () => {
    if (!pending) return;
    const ids = [...selected];
    setBusy(true);
    try {
      await pending.run(ids);
      onSelectionChange([]);
      setPendingKey(null);
    } catch {
      /* ⛔ 动作自身抛错时保留选择与确认框，允许重试；⛔ 不能让 void 调用变成未捕获拒绝。 */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mlt">
      <label className="mlt-search-wrap">
        <Search size={12} aria-hidden="true" />
        <input className="mlt-search" type="search" value={query}
          onChange={(e) => { onQueryChange(e.target.value); if (selected.length) onSelectionChange([]); }}
          placeholder={placeholder} aria-label="搜索" data-mlt-search="" />
      </label>
      {filters.length ? (
        <div className="mlt-filters">
          {filters.map((f) => (
            <div className="mlt-filter-wrap" data-mlt-filter={f.key} key={f.key}>
              {/* ⛔ 全仓禁用原生 select（守卫【197】）：统一走 AppSelect（弹层 portal 到 body） */}
              <AppSelect className="mlt-select" ariaLabel={f.label} value={f.value}
                onChange={f.onChange} options={f.options} title={f.label} />
            </div>
          ))}
        </div>
      ) : null}
      <label className="mlt-selectall">
        <input type="checkbox" className="mlt-check" checked={allSelected}
          onChange={(e) => onSelectionChange(toggleSelection(selected, visibleIds, e.target.checked))} />
        全选当前 {visibleIds.length} 条{summary ? ` · ${summary}` : ""}
      </label>

      {selected.length ? (
        <div className="mlt-batch" role="group" aria-label="批量管理" data-mlt-batch="">
          <span className="mlt-batch-count">已选 {selected.length} 条</span>
          {actions.map((a) => (
            <button type="button" key={a.key} className={a.danger ? "danger" : ""} onClick={() => setPendingKey(a.key)}>
              {a.label}
            </button>
          ))}
          <button type="button" onClick={() => { onSelectionChange([]); setPendingKey(null); }}>取消选择</button>
        </div>
      ) : null}

      {pending ? (
        <div className="mlt-confirm" role="alertdialog" aria-label="确认批量操作" data-mlt-confirm="">
          <p>⛔ {pending.confirmText(selected.length)} 此操作不可撤销。</p>
          <div className="mlt-confirm-actions">
            <button type="button" onClick={() => setPendingKey(null)}>返回</button>
            <button type="button" className="danger" disabled={busy} onClick={() => void confirm()}>
              {busy ? "处理中…" : "确认执行"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
