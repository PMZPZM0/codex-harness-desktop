/**
 * 设计参考设置页（11-15，用户：「VoltAgent/awesome-design-md 看看怎么用起来」）
 *
 * 随包 84 份品牌 DESIGN.md（Google Stitch 格式，MIT）：左分类 tab、上搜索、卡片网格（分页 24），
 * 点卡片看整份规范（Markdown 渲染），可复制 / 导出到当前项目 design-references/ / 交给 Codex 直接做。
 * ⛔ 只作风格参考：页脚与按钮文案都写明「不复制品牌 logo / 商标」。
 * ⛔ 数据端与工具 design_md 同源（resources/design-md/library.json → design-md:list/get/export）。
 */
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Palette } from "lucide-react";
import { Markdown } from "../markdown";
import { splitDesignMd } from "../../lib/design-md-preview.mjs";

type DesignItem = { slug: string; name: string; category: string; description: string };
type DesignCategory = { key: string; label: string; en: string; count: number };
type DesignDoc = DesignItem & { designMd: string };
type LibraryMeta = { source: string; home: string; license: string; fetchedAt: string; libraryTotal: number; categories: DesignCategory[] };

const PAGE = 24;

/** 设计参考页：浏览 84 份品牌 DESIGN.md，复制 / 导出到项目 / 交给 Codex。 */
export function DesignLibraryPage({ workspace = "", onHandoff, onCloseSettings }: {
  workspace?: string;
  /** 交给 Codex：把提示词填进主输入框（⛔ 不自动发送 —— 用户可先改再发，避免误触发一轮） */
  onHandoff?: (text: string) => void;
  onCloseSettings?: () => void;
}) {
  const [meta, setMeta] = useState<LibraryMeta | null>(null);
  const [items, setItems] = useState<DesignItem[]>([]);
  const [cat, setCat] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<DesignDoc | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [flash, setFlash] = useState("");
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    let alive = true;
    void window.codex.designMdList({ limit: 200 })
      .then((res) => {
        if (!alive) return;
        setItems(res.items ?? []);
        setMeta({ source: res.source, home: res.home, license: res.license, fetchedAt: res.fetchedAt, libraryTotal: res.libraryTotal, categories: res.categories ?? [] });
      })
      .catch((error) => { if (alive) setLoadErr(`设计参考库加载失败：${String((error as Error)?.message ?? error)}`); });
    return () => { alive = false; };
  }, []);

  const catLabel = (key: string) => meta?.categories.find((c) => c.key === key)?.label ?? key;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (cat !== "all" && item.category !== cat) return false;
      return !q || `${item.name} ${item.slug} ${item.description} ${catLabel(item.category)}`.toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, cat, query, meta]);

  useEffect(() => setPage(1), [cat, query]);

  const totalPages = Math.max(1, Math.ceil(results.length / PAGE));
  const currentPage = Math.min(page, totalPages);
  const shown = results.slice((currentPage - 1) * PAGE, currentPage * PAGE);

  const openDetail = async (slug: string) => {
    setDetailBusy(true);
    setCopied(false);
    setFlash("");
    try {
      const doc = await window.codex.designMdGet(slug);
      if (!doc) { setLoadErr(`没有找到设计规范 ${slug}`); return; }
      setDetail(doc);
    } catch (error) {
      setLoadErr(`读取设计规范失败：${String((error as Error)?.message ?? error)}`);
    } finally {
      setDetailBusy(false);
    }
  };

  const parsed = useMemo(() => (detail ? splitDesignMd(detail.designMd) : null), [detail]);

  const attribution = (doc: DesignDoc) => `\n\n<!-- 风格参考：${doc.name}（${doc.slug}）· ${catLabel(doc.category)} · VoltAgent/awesome-design-md（MIT） -->\n`;

  const copyDoc = async () => {
    if (!detail) return;
    try {
      await window.codex.writeClipboard(`${detail.designMd}${attribution(detail)}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { setFlash("复制失败（剪贴板不可用）"); }
  };

  const exportDoc = async () => {
    if (!detail) return;
    if (!workspace) { setFlash("先在顶栏选一个项目地址，再导出"); return; }
    try {
      const res = await window.codex.designMdExport({ slug: detail.slug, dir: workspace });
      setFlash(res.ok ? `已导出：${res.path}` : `导出失败：${res.error ?? "未知原因"}`);
    } catch (error) {
      setFlash(`导出失败：${String((error as Error)?.message ?? error)}`);
    }
  };

  const sendToCodex = () => {
    if (!detail || !onHandoff) return;
    const text = [
      `用 design_md 工具取「${detail.name}」（slug=${detail.slug}）的完整设计规范，然后按它把当前项目做成这种风格的界面：`,
      `先把规范里的颜色 / 字体 / 圆角 / 间距映射到项目现有的 CSS 变量，再按组件规则实现页面与各状态（default / hover / disabled / 空 / 加载 / 错误）。`,
      `⛔ 只作风格参考：不复制品牌 logo / 商标 / 专有字体，界面里不要出现该品牌名字冒充官方。`,
    ].join("");
    onHandoff(text);
    onCloseSettings?.();
  };

  return (
    <div className="comp-lib design-lib">
      <div className="comp-lib-head">
        <h3><Palette size={16} /> 设计参考</h3>
        <p className="comp-lib-sub">
          来自真实网站的品牌 <b>DESIGN.md</b>（<b>{meta?.libraryTotal ?? 84}</b> 份，{meta?.license ?? "MIT"} 许可）：
          颜色 / 字体 / 圆角 / 组件规则 / Do&apos;s &amp; Don&apos;ts 全是现成的。点卡片看规范、复制或导出到项目，
          也可以直接「交给 Codex」按这套设计语言做界面。
          {meta?.home ? (
            <button type="button" className="design-lib-source" onClick={() => void window.codex.openExternal(meta.home)} title={meta.home}>
              来源 {meta.source} <ExternalLink size={11} />
            </button>
          ) : null}
        </p>
      </div>

      <div className="design-lib-tabs" role="tablist" aria-label="设计参考分类">
        <button type="button" role="tab" aria-selected={cat === "all"} className={cat === "all" ? "active" : ""} onClick={() => setCat("all")}>
          全部 <small>{items.length}</small>
        </button>
        {(meta?.categories ?? []).map((c) => (
          <button key={c.key} type="button" role="tab" aria-selected={cat === c.key} className={cat === c.key ? "active" : ""} onClick={() => setCat(c.key)}>
            {c.label} <small>{c.count}</small>
          </button>
        ))}
      </div>

      <div className="comp-lib-filter-row">
        <input
          className="ui-skin-search"
          placeholder="搜索品牌 / 风格（如 minimal dark、fintech、editorial）…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {loadErr && <p className="comp-lib-error" role="alert">{loadErr}</p>}
      <div className="ui-skin-grid comp-lib-grid design-lib-grid">
        {shown.map((item) => (
          <button
            key={item.slug}
            type="button"
            className="ui-skin-cell comp-lib-cell design-lib-cell"
            title={`${item.name} · ${item.slug}（点击看设计规范）`}
            onClick={() => void openDetail(item.slug)}
            disabled={detailBusy}
          >
            <span className="design-lib-cell-name">{item.name}</span>
            <span className="design-lib-cell-meta">{catLabel(item.category)} · {item.slug}</span>
            <span className="design-lib-cell-desc">{item.description || "上游未提供简介"}</span>
          </button>
        ))}
      </div>
      {!items.length && !loadErr && <p className="ui-skin-empty">正在加载设计参考库…</p>}
      {items.length > 0 && results.length === 0 && !loadErr && <p className="ui-skin-empty">没有匹配的设计参考。</p>}

      {results.length > PAGE && (
        <div className="comp-lib-pager">
          <span className="comp-lib-pager-info">共 {results.length} 份 · 第 <b>{currentPage}</b> / {totalPages} 页</span>
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

      {detail && (
        <div className="comp-lib-detail-backdrop" onClick={() => setDetail(null)}>
          <div className="comp-lib-detail design-lib-detail" onClick={(event) => event.stopPropagation()}>
            <div className="comp-lib-detail-head">
              <div>
                <strong>{detail.name}</strong>
                <span className="comp-lib-by">{catLabel(detail.category)} · {detail.slug} · {meta?.license ?? "MIT"}</span>
              </div>
              <div className="comp-lib-detail-actions">
                <button type="button" className="comp-lib-copy" onClick={() => void copyDoc()}>{copied ? "✓ 已复制" : "复制 DESIGN.md"}</button>
                <button type="button" className="secondary-setting" onClick={() => void exportDoc()}>导出到项目</button>
                {onHandoff ? <button type="button" className="comp-lib-copy" title="填进输入框（可先改再发）" onClick={sendToCodex}>交给 Codex</button> : null}
                <button type="button" className="comp-lib-close" title="关闭" onClick={() => setDetail(null)}>✕</button>
              </div>
            </div>
            {flash && <p className="design-lib-flash" role="status">{flash}</p>}
            {parsed && parsed.colors.length > 0 && (
              <div className="design-lib-swatches" aria-label="配色色板">
                {parsed.colors.map((color) => (
                  <span className="design-lib-swatch" key={`${color.name}-${color.hex}`} title={`${color.name} ${color.hex}`}>
                    <i style={{ background: color.hex }} />
                    <em>{color.name}</em>
                    <code>{color.hex}</code>
                  </span>
                ))}
              </div>
            )}
            {parsed && parsed.tokens && (
              <details className="design-lib-tokens">
                <summary>tokens（YAML：颜色 / 字体 / 圆角 / 组件）</summary>
                <pre>{parsed.tokens}</pre>
              </details>
            )}
            <div className="design-lib-md markdown">
              <Markdown>{parsed?.body ?? detail.designMd}</Markdown>
            </div>
            <p className="design-lib-note">风格参考：其中的色值 / 规则可直接用于自建界面；⛔ 不要复制品牌 logo、商标、图片或专有字体，界面里也不要冒充该品牌的官方产品。</p>
          </div>
        </div>
      )}
    </div>
  );
}
