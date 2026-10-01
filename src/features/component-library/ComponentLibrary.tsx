/**
 * 组件库设置页（10-01 用户：「把这个前端组件库做一个单独设置界面，播放跟代码复制都保留，
 * 方便用户开发别的软件使用」）
 *
 * 左：类目 tab；右：搜索 + 分页预览网格（SkinHost preview = 真实渲染"播放"）+
 * 点击卡片弹出代码视图（HTML+CSS 原文）+ 一键复制（window.codex.clipboardWrite）。
 * ⛔ 预览网格**分页渲染**（每页 24）：一次挂几百个 shadow root 会卡死页面（工坊同款坑）。
 * ⛔ 代码来自库原文（ingest 时已剥 <script>），展示用 <pre> 文本节点、不用 innerHTML —— 防注入。
 */
import { useEffect, useMemo, useState } from "react";
import { UI_SKIN_CATALOG, UI_SKIN_CATS } from "../../lib/ui-skin/catalog.gen";
import { loadCategory } from "../../lib/ui-skin/load";
import { SkinHost } from "../../components/SkinHost";

const PAGE = 24;

/** 类目 → 展示名（UI_SKIN_CATS 生成物自带 label；旧 key 清理见下方模块体）。 */
const catLabel = (cat: string) => UI_SKIN_CATS.find((c) => c.cat === cat)?.label ?? cat;

// 个性化皮肤（2026-09-30/10-01 一版）已按用户要求删除：清掉它留在 localStorage 的状态，别成孤儿。
try {
  localStorage.removeItem("ui-skin-state-v2");
  localStorage.removeItem("ui-skin-bindings-v1");
} catch { /* 无 localStorage 环境忽略 */ }

export function ComponentLibraryPage() {
  const [cat, setCat] = useState<string>(UI_SKIN_CATS[0]?.cat ?? "Buttons");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<{ cat: string; id: string; name: string; author: string; html: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [loadErr, setLoadErr] = useState("");

  // 类目懒加载 + 失败可见（load.ts 返回 error 字段 —— ⛔ 别吞，静默空白会被当成"没这个功能"）
  useEffect(() => {
    let disposed = false;
    setLoadErr("");
    void loadCategory(cat).then((r) => {
      if (!disposed && r.error) setLoadErr(`库数据加载失败：${r.error}`);
    });
    return () => { disposed = true; };
  }, [cat]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return UI_SKIN_CATALOG.filter(
      (e) => e.cat === cat && (!q || e.name.toLowerCase().includes(q) || e.author.toLowerCase().includes(q)),
    );
  }, [cat, query]);

  useEffect(() => setPage(1), [cat, query]);

  const shown = results.slice(0, page * PAGE);

  const openDetail = async (catArg: string, id: string, name: string, author: string) => {
    const r = await loadCategory(catArg);
    const item = r.items.find((x) => x.id === id);
    if (!item) { setLoadErr(`组件 ${id} 的代码加载失败${r.error ? `：${r.error}` : ""}`); return; }
    setLoadErr("");
    setCopied(false);
    setDetail({ cat: catArg, id, name, author, html: item.html });
  };

  const copyCode = async () => {
    if (!detail) return;
    try {
      await window.codex.writeClipboard(`${detail.html}\n<!-- Uiverse "${detail.name}" by ${detail.author} · MIT License -->`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  };

  return (
    <div className="comp-lib">
      <div className="comp-lib-head">
        <h3>组件库</h3>
        <p className="comp-lib-sub">
          Uiverse.io Galaxy 社区组件（<b>{UI_SKIN_CATALOG.length}</b> 个，MIT 许可）：点卡片看代码、一键复制，
          开发自己的网页 / 软件时直接粘过去用。要在本应用里换控件外观请去「控件皮肤」。
        </p>
      </div>
      <div className="ui-skin-cats">
        {UI_SKIN_CATS.map((c) => (
          <button key={c.cat} type="button" className={`ui-skin-cat ${c.cat === cat ? "active" : ""}`} onClick={() => setCat(c.cat)}>
            {catLabel(c.cat)} <i>{c.count}</i>
          </button>
        ))}
      </div>
      <input
        className="ui-skin-search"
        placeholder="搜索组件名 / 作者…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {loadErr && <p className="comp-lib-error" role="alert">{loadErr}</p>}
      <div className="ui-skin-grid comp-lib-grid">
        {shown.map((e) => (
          <button
            key={`${e.cat}/${e.id}`}
            type="button"
            className="ui-skin-cell comp-lib-cell"
            title={`${e.name} · by ${e.author}（点击看代码）`}
            onClick={() => void openDetail(e.cat, e.id, e.name, e.author)}
          >
            <span className="ui-skin-preview">
              <SkinHost elementId={`${e.cat}/${e.id}`} />
            </span>
            <span className="ui-skin-cell-name">{e.name}</span>
            <span className="comp-lib-copy-hint">复制代码</span>
          </button>
        ))}
      </div>
      {shown.length < results.length && (
        <button type="button" className="ui-skin-more" onClick={() => setPage((p) => p + 1)}>
          加载更多（{results.length - shown.length} 个剩余）
        </button>
      )}
      {results.length === 0 && !loadErr && <p className="ui-skin-empty">没有匹配的组件。</p>}

      {detail && (
        <div className="comp-lib-detail-backdrop" onClick={() => setDetail(null)}>
          <div className="comp-lib-detail" onClick={(e) => e.stopPropagation()}>
            <div className="comp-lib-detail-head">
              <div>
                <strong>{detail.name}</strong>
                <span className="comp-lib-by">by {detail.author} · {catLabel(detail.cat)} · MIT</span>
              </div>
              <div className="comp-lib-detail-actions">
                <button type="button" className="comp-lib-copy" onClick={() => void copyCode()}>
                  {copied ? "✓ 已复制" : "复制代码"}
                </button>
                <button type="button" className="comp-lib-close" title="关闭" onClick={() => setDetail(null)}>✕</button>
              </div>
            </div>
            <div className="comp-lib-preview-row">
              <SkinHost elementId={`${detail.cat}/${detail.id}`} />
            </div>
            <pre className="comp-lib-code">{detail.html}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
