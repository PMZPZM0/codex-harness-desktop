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
import { AppSelect } from "../../components/AppSelect";

const PAGE = 24;

/** 类目 → 展示名（UI_SKIN_CATS 生成物自带 label；旧 key 清理见下方模块体）。 */
const catLabel = (cat: string) => UI_SKIN_CATS.find((c) => c.cat === cat)?.label ?? cat;

// 个性化皮肤（2026-09-30/10-01 一版）已按用户要求删除：清掉它留在 localStorage 的状态，别成孤儿。
try {
  localStorage.removeItem("ui-skin-state-v2");
  localStorage.removeItem("ui-skin-bindings-v1");
} catch { /* 无 localStorage 环境忽略 */ }

/** 组件库页：按类目浏览打包好的组件，可搜索与看详情。 */
export function ComponentLibraryPage({ onHandoff, onRestore }: {
  onRestore?: (doc: unknown) => Promise<void>;
  /** 交给 Codex / 画布：把提示词填进主输入框（⛔ 不自动发送，用户可先改再发）。 */
  onHandoff?: (text: string) => void;
} = {}) {
  const [cat, setCat] = useState<string>(UI_SKIN_CATS[0]?.cat ?? "Buttons");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<{ cat: string; id: string; name: string; author: string; html: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  /* 11-18：我的组件（画布存进来的）。⛔ 与随包 catalog 分开列 —— 那是只读社区件，这是用户自己的。 */
  const [myKit, setMyKit] = useState<{ id: string; name: string; createdAt: number; bytes: number }[]>([]);
  useEffect(() => {
    let alive = true;
    void window.codex.listUiKitItems().then((rows) => { if (alive) setMyKit(rows ?? []); }).catch(() => { /* 读不到就不显示这一栏 */ });
    return () => { alive = false; };
  }, []);
  const kitToCanvas = async (id: string) => {
    if (!onRestore) return;
    try {
      const item = await window.codex.getUiKitItem(id);
      if (!item) throw new Error("该组件已不存在");
      await onRestore(item.doc);
    } catch (error) { setLoadErr(`恢复画布失败：${String(error)}`); }
  };
  const kitRemove = async (id: string) => {
    await window.codex.removeUiKitItem(id).catch(() => null);
    setMyKit((prev) => prev.filter((x) => x.id !== id));
  };

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

  /* 10-27 用户令：「加一个翻页功能」⇒ 从「加载更多」改成**真分页**：
     每页固定 PAGE 个，页码切换只换这一屏，不再无限下拉。 */
  const totalPages = Math.max(1, Math.ceil(results.length / PAGE));
  const currentPage = Math.min(page, totalPages);
  const shown = results.slice((currentPage - 1) * PAGE, currentPage * PAGE);

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

  /* 11-18（前端与设计大类）：组件 → 画布。用户令「组件库和画布要联动起来」。
     ⛔ 只把组件代码带过去让 Codex 插入/改造；⛔ 不在画布里嵌组件库面板（11-15 用户否过）。 */
  const sendToCanvas = () => {
    if (!detail || !onHandoff) return;
    const snippet = String(detail.html ?? "").slice(0, 6000);
    const text = [
      `打开「前端开发」画布，把这个组件落进一屏界面：${detail.name}（${detail.cat}）。`,
      "步骤：① frontend_get_doc 取当前文档；② frontend_apply_doc 把组件放进一屏（保留视觉特征，按画布主题调色）；③ 回复说明改了什么。",
      "组件原始代码：",
      "```html",
      snippet,
      "```",
    ].join("\n");
    onHandoff(text);
  };

  return (
    <div className="comp-lib">
      <div className="comp-lib-head">
        <h3>组件库</h3>
      {/* 11-18：我的组件（画布存进来的）。⛔ 只在这里列，不混进随包社区件。 */}
      {myKit.length ? (
        <div className="comp-lib-mine">
          <strong>我的组件（{myKit.length}）</strong>
          <ul>
            {myKit.map((item) => (
              <li key={item.id}>
                <span title={`${Math.round(item.bytes / 1024)}KB · ${new Date(item.createdAt).toLocaleString("zh-CN")}`}>{item.name}</span>
                {onRestore ? <button type="button" className="comp-lib-copy" onClick={() => void kitToCanvas(item.id)}>去画布继续</button> : null}
                <button type="button" className="comp-lib-copy" onClick={() => void kitRemove(item.id)}>删除</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
        <p className="comp-lib-sub">
          Uiverse.io Galaxy 社区组件（<b>{UI_SKIN_CATALOG.length}</b> 个，MIT 许可）：点卡片看代码、一键复制，
          开发自己的网页 / 软件时直接粘过去用。要在本应用里换控件外观请去「控件皮肤」。
        </p>
      </div>
      {/* 10-27 用户：「搜索框太长，分类做成下拉框选项，在搜索框这一排靠右」 */}
      <div className="comp-lib-filter-row">
        <input
          className="ui-skin-search"
          placeholder="搜索组件名 / 作者…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="comp-lib-cat-filter">
          <span>分类</span>
          <AppSelect
            className="comp-lib-cat-select"
            value={cat}
            ariaLabel="组件分类筛选"
            options={UI_SKIN_CATS.map((c) => ({ value: c.cat, label: `${catLabel(c.cat)} ${c.count}` }))}
            onChange={(next) => setCat(next)}
          />
        </span>
      </div>
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
      {results.length > PAGE && (
        <div className="comp-lib-pager">
          <span className="comp-lib-pager-info">共 {results.length} 个 · 第 <b>{currentPage}</b> / {totalPages} 页</span>
          <div className="comp-lib-pager-actions">
            <button type="button" className="secondary-setting" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((n) => n === 1 || n === totalPages || Math.abs(n - currentPage) <= 1)
              .map((n, idx, arr) => (
                <span key={n} className="comp-lib-pager-slot">
                  {idx > 0 && arr[idx - 1] !== n - 1 ? <span className="comp-lib-pager-gap">…</span> : null}
                  <button type="button" className={`comp-lib-pager-num${n === currentPage ? " active" : ""}`} onClick={() => setPage(n)}>{n}</button>
                </span>
              ))}
            <button type="button" className="secondary-setting" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>下一页</button>
          </div>
        </div>
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
                {onHandoff ? <button type="button" className="comp-lib-copy" title="带着这个组件去前端开发画布（填入输入框，可先改再发）" onClick={sendToCanvas}>放进画布</button> : null}
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
