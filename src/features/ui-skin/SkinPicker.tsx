/**
 * 控件皮肤 · 工坊浏览/绑定面板
 *
 * 左：原型（slot）清单；右：Uiverse 库浏览器（分类 tab + 搜索 + 实时预览网格）。
 * ⛔ 预览网格**分页渲染**（每页 36）：一次挂 1200 个 shadow root 会卡死页面。
 */
import { useEffect, useMemo, useState } from "react";
import { UI_SKIN_CATALOG, UI_SKIN_CATS } from "./catalog.gen";
import { loadCategory } from "../../lib/ui-skin/load";
import { SkinHost } from "../../components/SkinHost";
import { SKIN_LIB_LABELS, SKIN_SLOTS, type SkinSlotId } from "./skin-slots";
import { allBindings, getBinding, setBinding, subscribe } from "../../lib/ui-skin/store";

const PAGE = 36;

export function UiSkinWorkshop() {
  const [slotId, setSlotId] = useState<SkinSlotId>("toggle-switch");
  const [cat, setCat] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [, force] = useState(0);

  useEffect(() => subscribe(() => force((n) => n + 1)), []);

  const slot = SKIN_SLOTS.find((s) => s.id === slotId) ?? SKIN_SLOTS[0];
  const cats = useMemo(() => UI_SKIN_CATS.filter((c) => slot.cats.includes(c.cat)), [slot]);
  const activeCat = cat && cats.some((c) => c.cat === cat) ? cat : cats[0]?.cat ?? "";

  // 搜索（全库按名字/作者过滤；只在当前类目里渲染预览）
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return UI_SKIN_CATALOG.filter(
      (e) => e.cat === activeCat && (!q || e.name.toLowerCase().includes(q) || e.author.toLowerCase().includes(q)),
    );
  }, [activeCat, query]);

  useEffect(() => setPage(1), [activeCat, query]);

  const shown = results.slice(0, page * PAGE);
  const binding = getBinding(slotId);

  return (
    <div className="ui-skin-workshop">
      {/* 左列：原型清单 */}
      <aside className="ui-skin-slots">
        <p className="ui-skin-hint">选择要换肤的控件原型，再从右侧挑一个效果。</p>
        {SKIN_SLOTS.map((s) => {
          const b = getBinding(s.id);
          const def = SKIN_SLOTS.find((x) => x.id === s.id)!;
          return (
            <button
              key={s.id}
              type="button"
              className={`ui-skin-slot ${s.id === slotId ? "active" : ""}`}
              onClick={() => { setSlotId(s.id); setCat(null); }}
            >
              <span className="ui-skin-slot-label">{s.label}</span>
              <span className="ui-skin-slot-sub" title={def.wired}>{s.wired}</span>
              {b ? (
                <span className="ui-skin-slot-bound">
                  已绑定：{(UI_SKIN_CATALOG.find((e) => `${e.cat}/${e.id}` === b)?.name) ?? b}
                  <i
                    role="button"
                    tabIndex={0}
                    className="ui-skin-slot-clear"
                    title="恢复默认"
                    onClick={(ev) => { ev.stopPropagation(); setBinding(s.id, null); }}
                    onKeyDown={(ev) => { if (ev.key === "Enter") { ev.stopPropagation(); setBinding(s.id, null); } }}
                  >
                    ✕
                  </i>
                </span>
              ) : (
                <span className="ui-skin-slot-unbound">默认样式</span>
              )}
            </button>
          );
        })}
        <p className="ui-skin-note">
          库来自 <b>Uiverse.io Galaxy</b>（MIT，3802 个元素）。效果按原型全局生效；
          元素自带配色，可能与应用主题有色差——不满意随时恢复默认。
        </p>
      </aside>

      {/* 右侧：库浏览器 */}
      <div className="ui-skin-browser">
        <div className="ui-skin-cats">
          {cats.map((c) => (
            <button key={c.cat} type="button" className={`ui-skin-cat ${c.cat === activeCat ? "active" : ""}`} onClick={() => setCat(c.cat)}>
              {SKIN_LIB_LABELS[c.cat] ?? c.cat} <i>{c.count}</i>
            </button>
          ))}
        </div>
        <input
          className="ui-skin-search"
          placeholder="搜索效果 / 作者…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {(() => {
          const b = allBindings();
          void b;
          return null;
        })()}
        <div className="ui-skin-grid">
          {shown.map((e) => {
            const full = `${e.cat}/${e.id}`;
            const isBound = binding === full;
            return (
              <button
                key={e.id}
                type="button"
                className={`ui-skin-cell ${isBound ? "bound" : ""}`}
                title={`${e.name} · by ${e.author}${isBound ? "（当前绑定）" : ""}`}
                onClick={() => setBinding(slotId, full)}
              >
                <span className="ui-skin-preview">
                  <SkinHost elementId={full} label={slotId === "toggle-switch" ? undefined : undefined} preview />
                </span>
                <span className="ui-skin-cell-name">{e.name}</span>
                {isBound && <span className="ui-skin-cell-badge">使用中</span>}
              </button>
            );
          })}
        </div>
        {shown.length < results.length && (
          <button type="button" className="ui-skin-more" onClick={() => setPage((p) => p + 1)}>
            加载更多（{results.length - shown.length} 个剩余）
          </button>
        )}
        {results.length === 0 && <p className="ui-skin-empty">没有匹配的元素。</p>}
      </div>
    </div>
  );
}

/** 预览懒加载由 SkinHost 内部处理（loadCategory 按类缓存）；这里仅触发一次预热。 */
export function preloadUiSkinCategory(cat: string) {
  void loadCategory(cat);
}
