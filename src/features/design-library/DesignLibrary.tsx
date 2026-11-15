/**
 * 设计参考设置页（11-15，用户：「VoltAgent/awesome-design-md 看看怎么用起来」）
 *
 * 随包 84 份品牌 DESIGN.md（Google Stitch 格式，MIT）：搜索 + 分类下拉过滤、卡片网格（分页 24）。
 * 点卡片看规范：**默认中文导读**（中文一句话 + 按用途分组的中文色板），可切「英文原文」（完整 DESIGN.md）。
 * 可复制 / 导出到项目（项目可选：当前工作区 / 其它项目 / 自选目录）/ 交给 Codex 做。
 * ⛔ 用户 11-15 明令：展示用中文，但**复制 / 导出 / 交给 Codex 的一律是英文原文**。
 * ⛔ 只作风格参考：不复制品牌 logo / 商标 / 专有字体。数据端与工具 design_md 同源。
 */
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Palette } from "lucide-react";
import { Markdown } from "../markdown";
import { AppSelect } from "../../components/AppSelect";
import { groupColors, splitDesignMd } from "../../lib/design-md-preview.mjs";

type DesignItem = { slug: string; name: string; category: string; description: string; zh: string };
type DesignCategory = { key: string; label: string; en: string; count: number };
type DesignDoc = DesignItem & { designMd: string };
type LibraryMeta = { source: string; home: string; license: string; fetchedAt: string; libraryTotal: number; categories: DesignCategory[] };

const PAGE = 24;

/** 路径尾段（项目下拉里显示短名）。 */
function projectName(dir: string): string {
  const parts = String(dir ?? "").split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || dir;
}

/** 设计参考页：浏览 84 份品牌 DESIGN.md，复制 / 导出到项目 / 交给 Codex。 */
export function DesignLibraryPage({ workspace = "", projects = [], onHandoff, onCloseSettings }: {
  workspace?: string;
  /** 已知项目地址（侧栏项目分组）—— 导出目标下拉用 */
  projects?: string[];
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
  const [tab, setTab] = useState<"zh" | "en">("zh");
  const [copied, setCopied] = useState(false);
  const [flash, setFlash] = useState("");
  const [loadErr, setLoadErr] = useState("");
  /** 导出目标：默认当前工作区；从下拉切换或自选目录 */
  const [exportDir, setExportDir] = useState(workspace);
  const [customDirs, setCustomDirs] = useState<string[]>([]);

  useEffect(() => { if (workspace) setExportDir(workspace); }, [workspace]);

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
      return !q || `${item.name} ${item.slug} ${item.description} ${item.zh ?? ""} ${catLabel(item.category)}`.toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, cat, query, meta]);

  useEffect(() => setPage(1), [cat, query]);

  const totalPages = Math.max(1, Math.ceil(results.length / PAGE));
  const currentPage = Math.min(page, totalPages);
  const shown = results.slice((currentPage - 1) * PAGE, currentPage * PAGE);

  const parsed = useMemo(() => (detail ? splitDesignMd(detail.designMd) : null), [detail]);
  const colorGroups = useMemo(() => (parsed ? groupColors(parsed.colors) : []), [parsed]);

  const openDetail = async (slug: string) => {
    setDetailBusy(true);
    setCopied(false);
    setFlash("");
    setTab("zh");
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
    if (!exportDir) { setFlash("先选择导出项目（或自选目录），再导出"); return; }
    try {
      const res = await window.codex.designMdExport({ slug: detail.slug, dir: exportDir });
      setFlash(res.ok ? `已导出到 ${projectName(exportDir)}：${res.path}` : `导出失败：${res.error ?? "未知原因"}`);
    } catch (error) {
      setFlash(`导出失败：${String((error as Error)?.message ?? error)}`);
    }
  };

  const pickExportDir = async (value: string) => {
    if (value !== "__pick__") { setExportDir(value); return; }
    try {
      const picked = await window.codex.chooseDirectory();
      if (picked) {
        setCustomDirs((current) => (current.includes(picked) ? current : [...current, picked]));
        setExportDir(picked);
      }
    } catch { /* 取消选择：保持当前目标 */ }
  };

  const exportOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ value: string; label: string }> = [];
    const push = (dir: string, label: string) => {
      if (!dir || seen.has(dir)) return;
      seen.add(dir);
      options.push({ value: dir, label });
    };
    if (workspace) push(workspace, `当前项目 · ${projectName(workspace)}`);
    for (const dir of projects) push(dir, `项目 · ${projectName(dir)}`);
    for (const dir of customDirs) push(dir, `自选目录 · ${projectName(dir)}`);
    options.push({ value: "__pick__", label: "选择其他目录…" });
    return options;
  }, [workspace, projects, customDirs]);

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
          颜色 / 字体 / 圆角 / 组件规则 / Do&apos;s &amp; Don&apos;ts 全是现成的。点卡片看中文导读，
          可复制 / 导出到项目，或「交给 Codex」按这套设计语言做界面。
          {meta?.home ? (
            <button type="button" className="design-lib-source" onClick={() => void window.codex.openExternal(meta.home)} title={meta.home}>
              来源 {meta.source} <ExternalLink size={11} />
            </button>
          ) : null}
        </p>
      </div>

      <div className="comp-lib-filter-row">
        <input
          className="ui-skin-search"
          placeholder="搜索品牌 / 风格（如 linear、minimal dark、金融）…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="comp-lib-cat-filter">
          <span>分类</span>
          <AppSelect
            className="comp-lib-cat-select"
            value={cat}
            ariaLabel="设计参考分类"
            options={[
              { value: "all", label: `全部 ${items.length}` },
              ...(meta?.categories ?? []).map((c) => ({ value: c.key, label: `${c.label} ${c.count}` })),
            ]}
            onChange={(next) => setCat(next)}
          />
        </span>
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
            <span className="design-lib-cell-desc">{item.zh || item.description || "上游未提供简介"}</span>
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
                <button type="button" className="comp-lib-copy" title="复制英文原文 DESIGN.md（给 Codex 用）" onClick={() => void copyDoc()}>{copied ? "✓ 已复制" : "复制 DESIGN.md"}</button>
                {onHandoff ? <button type="button" className="comp-lib-copy" title="填进输入框（可先改再发）" onClick={sendToCodex}>交给 Codex</button> : null}
                <button type="button" className="comp-lib-close" title="关闭" onClick={() => setDetail(null)}>✕</button>
              </div>
            </div>

            <div className="design-lib-tabs" role="tablist" aria-label="预览语言">
              <button type="button" role="tab" aria-selected={tab === "zh"} className={tab === "zh" ? "active" : ""} onClick={() => setTab("zh")}>中文导读</button>
              <button type="button" role="tab" aria-selected={tab === "en"} className={tab === "en" ? "active" : ""} onClick={() => setTab("en")}>英文原文</button>
            </div>

            {tab === "zh" ? (
              <div className="design-lib-md design-lib-guide">
                <p className="design-lib-zh-line">{detail.zh || "上游未提供中文导读。"}</p>
                {colorGroups.map((group) => (
                  <div className="design-lib-group" key={group.key}>
                    <span className="design-lib-group-label">{group.label}</span>
                    <div className="design-lib-swatches">
                      {group.items.map((color) => (
                        <span className="design-lib-swatch" key={`${color.name}-${color.hex}`} title={`${color.name} ${color.hex}`}>
                          <i style={{ background: color.hex }} />
                          <em>{color.label}</em>
                          <code>{color.hex}</code>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {!colorGroups.length && <p className="design-lib-hint">这份规范没有 YAML tokens；完整规则在「英文原文」里。</p>}
                <p className="design-lib-hint">复制 / 导出 / 交给 Codex 使用的都是<b>英文原文 DESIGN.md</b>；中文只用于这里的展示。</p>
              </div>
            ) : (
              <div className="design-lib-md markdown">
                {parsed && parsed.tokens && (
                  <details className="design-lib-tokens">
                    <summary>tokens（YAML：颜色 / 字体 / 圆角 / 组件）</summary>
                    <pre>{parsed.tokens}</pre>
                  </details>
                )}
                <Markdown>{parsed?.body ?? detail.designMd}</Markdown>
              </div>
            )}

            <div className="design-lib-export">
              <span>导出到</span>
              <AppSelect
                className="design-lib-export-select"
                value={exportDir}
                ariaLabel="导出目标项目"
                options={exportOptions}
                onChange={(value) => void pickExportDir(value)}
              />
              <button type="button" className="secondary-setting" onClick={() => void exportDoc()}>导出到项目</button>
            </div>
            {flash && <p className="design-lib-flash" role="status">{flash}</p>}
            <p className="design-lib-note">风格参考：其中的色值 / 规则可直接用于自建界面；⛔ 不要复制品牌 logo、商标、图片或专有字体，界面里也不要冒充该品牌的官方产品。</p>
          </div>
        </div>
      )}
    </div>
  );
}
