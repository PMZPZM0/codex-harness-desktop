/**
 * 控件皮肤 · 工坊（2026-10-01 重构：套装优先）
 *
 * 上：**风格套装**画廊 —— 按作者聚类（同作者开关+加载器风格连贯），一次激活一套、
 *     全局所有接线点统一生效。卡片预览 = 该套装的开关小样（fit 归一）。
 * 下（折叠）：单品覆盖 —— 高级用法，仅覆盖单个槽位；⛔ 激活套装会清空全部覆盖。
 * ⛔ 网格**分页渲染**（套装每页 18 / 单品每页 36）：一次挂几百个 shadow root 会卡死页面。
 */
import { useEffect, useMemo, useState } from "react";
import { UI_SKIN_CATALOG, UI_SKIN_CATS } from "./catalog.gen";
import { UI_SKIN_PACKS } from "../../lib/ui-skin/packs.gen";
import { loadCategory } from "../../lib/ui-skin/load";
import { SkinHost } from "../../components/SkinHost";
import { SKIN_LIB_LABELS, SKIN_SLOTS, type SkinSlotId } from "./skin-slots";
import { getActivePack, getBinding, setActivePack, setBinding, subscribe } from "../../lib/ui-skin/store";

const PAGE = 36;
const PACK_PAGE = 18;

export function UiSkinWorkshop() {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((n) => n + 1)), []);
  const activePack = getActivePack();
  const [showCustom, setShowCustom] = useState(false);
  const [packPage, setPackPage] = useState(1);

  const packsShown = UI_SKIN_PACKS.slice(0, packPage * PACK_PAGE);

  return (
    <div className="ui-skin-workshop">
      {/* ── 套装画廊 ─────────────────────────────── */}
      <div className="ui-skin-browser">
        <p className="ui-skin-hint">
          选一个<b>风格套装</b>，全局开关与加载器一起换、风格统一；不想用了随时回默认。
        </p>
        <div className="ui-skin-grid">
          <button
            type="button"
            className={`ui-skin-cell ${!activePack ? "bound" : ""}`}
            title="恢复所有控件默认样式"
            onClick={() => setActivePack(null)}
          >
            <span className="ui-skin-preview ui-skin-preview-default">
              <span className="ui-skin-default-sample">
                <span className="toggle-switch on"><span className="toggle-track"><span className="toggle-thumb" /></span></span>
              </span>
            </span>
            <span className="ui-skin-cell-name">默认样式</span>
            {!activePack && <span className="ui-skin-cell-badge">使用中</span>}
          </button>
          {packsShown.map((p) => {
            const isOn = activePack?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`ui-skin-cell ${isOn ? "bound" : ""}`}
                title={`${p.label} 的套装（开关 + 加载器）${isOn ? "（使用中）" : ""}`}
                onClick={() => setActivePack(p.id)}
              >
                <span className="ui-skin-preview">
                  <SkinHost elementId={p.items["toggle-switch"]} fit={{ w: 44, h: 24 }} preview />
                </span>
                <span className="ui-skin-cell-name">{p.label}</span>
                {isOn && <span className="ui-skin-cell-badge">使用中</span>}
              </button>
            );
          })}
        </div>
        {packsShown.length < UI_SKIN_PACKS.length && (
          <button type="button" className="ui-skin-more" onClick={() => setPackPage((p) => p + 1)}>
            加载更多套装（{UI_SKIN_PACKS.length - packsShown.length} 个剩余）
          </button>
        )}
        <p className="ui-skin-note">
          库来自 <b>Uiverse.io Galaxy</b>（MIT）。套装按作者聚类——同作者的开关与加载器风格连贯；
          激活新套装会清掉下面的单品覆盖，保证全局统一。
        </p>
      </div>

      {/* ── 高级：单品覆盖（折叠） ─────────────────── */}
      <button type="button" className="ui-skin-custom-toggle" onClick={() => setShowCustom((v) => !v)}>
        {showCustom ? "▾" : "▸"} 高级：给单个控件位置单独挑效果（会打破统一，慎用）
      </button>
      {showCustom && <SlotBrowser />}
    </div>
  );
}

/** 单槽位浏览器（原单品库视图）：绑定写入「覆盖」，优先级高于套装。 */
function SlotBrowser() {
  const [slotId, setSlotId] = useState<SkinSlotId>("toggle-switch");
  const [cat, setCat] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const slot = SKIN_SLOTS.find((s) => s.id === slotId) ?? SKIN_SLOTS[0];
  const cats = useMemo(() => UI_SKIN_CATS.filter((c) => slot.cats.includes(c.cat)), [slot]);
  const activeCat = cat && cats.some((c) => c.cat === cat) ? cat : cats[0]?.cat ?? "";

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return UI_SKIN_CATALOG.filter(
      (e) => e.cat === activeCat && (!q || e.name.toLowerCase().includes(q) || e.author.toLowerCase().includes(q)),
    );
  }, [activeCat, query]);

  useEffect(() => setPage(1), [activeCat, query]);

  const shown = results.slice(0, page * PAGE);
  const binding = getBinding(slotId);
  const packOf = (full: string) => UI_SKIN_PACKS.find((p) => Object.values(p.items).includes(full))?.label;

  return (
    <div className="ui-skin-browser">
      <div className="ui-skin-slots ui-skin-slots-row">
        {SKIN_SLOTS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`ui-skin-slot ${s.id === slotId ? "active" : ""}`}
            onClick={() => { setSlotId(s.id); setCat(null); }}
          >
            <span className="ui-skin-slot-label">{s.label}</span>
            <span className="ui-skin-slot-sub" title={s.wired}>{s.wired}</span>
            {getBinding(s.id) ? (
              <span className="ui-skin-slot-bound">
                已绑定：{(UI_SKIN_CATALOG.find((e) => `${e.cat}/${e.id}` === getBinding(s.id))?.name) ?? getBinding(s.id)}
                <i
                  role="button"
                  tabIndex={0}
                  className="ui-skin-slot-clear"
                  title="撤销覆盖（回落套装/默认）"
                  onClick={(ev) => { ev.stopPropagation(); setBinding(s.id, null); }}
                  onKeyDown={(ev) => { if (ev.key === "Enter") { ev.stopPropagation(); setBinding(s.id, null); } }}
                >
                  ✕
                </i>
              </span>
            ) : (
              <span className="ui-skin-slot-unbound">跟随套装</span>
            )}
          </button>
        ))}
      </div>
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
      <div className="ui-skin-grid">
        {shown.map((e) => {
          const full = `${e.cat}/${e.id}`;
          const isBound = binding === full;
          const from = packOf(full);
          return (
            <button
              key={e.id}
              type="button"
              className={`ui-skin-cell ${isBound ? "bound" : ""}`}
              title={`${e.name} · by ${e.author}${from ? `（套装「${from}」成员）` : ""}${isBound ? "（当前覆盖）" : ""}`}
              onClick={() => setBinding(slotId, full)}
            >
              <span className="ui-skin-preview">
                <SkinHost elementId={full} preview />
              </span>
              <span className="ui-skin-cell-name">{e.name}</span>
              {from && !isBound && <span className="ui-skin-cell-pack">{from}</span>}
              {isBound && <span className="ui-skin-cell-badge">覆盖中</span>}
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
      <p className="ui-skin-note">覆盖仅作用于所选槽位，优先级高于套装；撤销后回落套装或默认。</p>
    </div>
  );
}

/** 预览懒加载由 SkinHost 内部处理（loadCategory 按类缓存）；这里仅触发一次预热。 */
export function preloadUiSkinCategory(cat: string) {
  void loadCategory(cat);
}
