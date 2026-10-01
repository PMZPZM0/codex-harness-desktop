/**
 * 专家市场包（expert-market 域，2026-10-01 立项）：SkillHub 技能包（skillhub.cn/skillspackage）。
 * 装包 = 元技能落盘 + 子技能逐个装 + 专家中心新增对应专家卡片（主进程 expert-market:install）。
 * 展示逻辑对齐技能市场（10-01 用户令）：市场浏览 / 我的技能包 两视图，装完卡片变「已安装 ✓」，
 * 每一步有 loading 与结果提示（顶部 toast + 卡片状态），不再让人怀疑有没有装上。
 */
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Package, Plus, RefreshCw, Search } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { SegmentedTabs } from "../../components/SettingsWidgets";

export type ExpertMarketSectionProps = { onBack: () => void; onInstalled: () => void; onNotice: (message: string) => void; localSkills: any[] };

type SkillsetEntry = { slug: string; displayName: string; summary: string; scene: string; subScene: string; children: string[] };

export function ExpertMarketSection({ onBack, onInstalled, onNotice, localSkills }: ExpertMarketSectionProps) {
  const [items, setItems] = useState<SkillsetEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState("");
  const [installedNow, setInstalledNow] = useState<string[]>([]);
  const [view, setView] = useState<"browse" | "installed">("browse");
  const pageSize = 12;

  // 已装技能包：本地技能里带 skillset 标记的条目（.skillhub.json kind=skillset）
  const installedPackages = localSkills.filter((entry: any) => entry.skillset);
  const installedSlugs = new Set<string>([...installedNow, ...installedPackages.map((entry: any) => String(entry.marketId ?? entry.folder ?? ""))]);

  const load = async (nextPage = page, nextQuery = query) => {
    setLoading(true);
    try {
      const result = await window.codex.listExpertMarketPackages({ page: nextPage, pageSize, query: nextQuery });
      setItems(result.items);
      setTotal(result.total);
    } catch (error: any) { onNotice(`专家市场包读取失败：${error.message}`); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(1, ""); }, []);
  useEffect(() => { const t = setTimeout(() => { setPage(1); void load(1, query); }, 350); return () => clearTimeout(t); }, [query]);

  const install = async (entry: SkillsetEntry) => {
    setInstalling(entry.slug);
    try {
      const result = await window.codex.installExpertMarketPackage({ slug: entry.slug });
      const missed = result.childFailures.length ? `；⚠️ ${result.childFailures.length} 个子技能未跟上（${result.childFailures.join("、")}），可到技能页重装` : `，${result.installedChildren.length} 个子技能已就位`;
      setInstalledNow((current) => [...current, entry.slug]);
      onNotice(`✅ 已安装「${result.displayName}」——专家中心新增对应专家卡片${missed}`);
      onInstalled();
    } catch (error: any) { onNotice(`❌ 安装失败：${error.message}`); }
    finally { setInstalling(""); }
  };

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <section className="settings-section stack expert-market-page">
      <div className="settings-copy channel-heading"><div><h2>专家市场包</h2></div><div className="settings-heading-actions"><button className="secondary-setting" onClick={onBack}><ArrowLeft size={14} />返回专家列表</button><button className="icon-button" title="刷新技能包列表" onClick={() => void load()}>{loading ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>

      <div className="resource-toolbar">
        <SegmentedTabs value={view} onChange={(next) => setView(next as "browse" | "installed")} options={[{ value: "browse", label: "市场浏览" }, { value: "installed", label: "我的技能包", count: installedPackages.length }]} />
        {view === "browse" && <div className="expert-market-search"><Search size={13} /><input value={query} placeholder="搜索技能包" onChange={(event) => setQuery(event.target.value)} /></div>}
      </div>

      {view === "installed" ? (
        installedPackages.length ? <div className="skill-card-grid">
          {installedPackages.map((entry: any) => (
            <article className="skill-card installed" key={entry.folder ?? entry.name}>
              <div className="skill-card-head">
                <strong className="expert-market-pack">{entry.name}</strong>
                <span className="skill-add is-installed" title="已安装"><Check size={14} /></span>
              </div>
              <p>{entry.description}</p>
              <footer><span>已安装</span><span>元技能 + 子技能在技能页管理</span></footer>
            </article>
          ))}
        </div> : <p className="muted">还没有安装技能包——去「市场浏览」挑一个。</p>
      ) : items.length > 0 ? <div className="skill-card-grid">
        {items.map((entry) => {
          const installed = installedSlugs.has(entry.slug);
          const busy = installing === entry.slug;
          return (
            <article className={`skill-card ${installed ? "installed" : ""}`} key={entry.slug} title={entry.summary}>
              <div className="skill-card-head">
                <strong className="expert-market-pack">{entry.displayName}</strong>
                <button className="skill-add" title={installed ? "已安装" : `安装「${entry.displayName}」（含 ${entry.children.length} 个子技能）`} disabled={Boolean(installing) || installed} onClick={() => void install(entry)}>{installed ? <Check size={14} /> : busy ? <Spinner /> : <Plus size={14} />}</button>
              </div>
              <p>{entry.summary}</p>
              <footer><span>{entry.children.length ? `${entry.children.length} 个子技能` : "独立技能"}</span><a href={`https://skillhub.cn/skillspackage`} onClick={(event) => { event.preventDefault(); void window.codex.openExternal("https://skillhub.cn/skillspackage"); }}>查看来源</a></footer>
            </article>
          );
        })}
      </div> : <p className="muted">{loading ? "正在加载技能包…" : "没有匹配的技能包。"}</p>}

      {view === "browse" && pageCount > 1 && <div className="skill-market-pagination">
        <span>共 {total} 个技能包 · 第 {page} / {pageCount} 页</span>
        <div>
          <button className="secondary-setting" disabled={loading || page <= 1} onClick={() => { const next = page - 1; setPage(next); void load(next); }}>上一页</button>
          <button className="secondary-setting" disabled={loading || page >= pageCount} onClick={() => { const next = page + 1; setPage(next); void load(next); }}>下一页</button>
        </div>
      </div>}
      <p className="muted expert-market-note"><Package size={12} /> 安装动作：包元技能与子技能写入技能目录（技能页可见并启停）+ 专家中心新增对应专家卡片，Codex 引擎自动重启加载。</p>
    </section>
  );
}
