/**
 * 专家市场包（expert-market 域，2026-10-01 立项）：SkillHub 技能包（skillhub.cn/skillspackage）。
 * 装包 = 元技能落盘 + 子技能逐个装 + 专家中心新增对应专家卡片（主进程 expert-market:install）。
 * 自带数据面（列表/安装状态在组件内），与组件库页同款自包含形态；装完回调宿主刷新专家列表。
 */
import { useEffect, useState } from "react";
import { Check, Package, Plus, RefreshCw, Search } from "lucide-react";
import { Spinner } from "../../components/CardShell";

export type ExpertMarketSectionProps = { onInstalled: () => void; onNotice: (message: string) => void };

type SkillsetEntry = { slug: string; displayName: string; summary: string; scene: string; subScene: string; children: string[] };

export function ExpertMarketSection({ onInstalled, onNotice }: ExpertMarketSectionProps) {
  const [items, setItems] = useState<SkillsetEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState("");
  const pageSize = 12;

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
      const missed = result.childFailures.length ? `；${result.childFailures.length} 个子技能未跟上（${result.childFailures.join("、")}）` : `，${result.installedChildren.length} 个子技能已就位`;
      onNotice(`已安装「${result.displayName}」，专家中心新增对应专家卡片${missed}`);
      onInstalled();
      setItems((current) => current.map((entry2) => (entry2.slug === entry.slug ? { ...entry2 } : entry2)));
      void load();
    } catch (error: any) { onNotice(`安装失败：${error.message}`); }
    finally { setInstalling(""); }
  };

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="expert-market">
      <div className="expert-market-head">
        <span className="expert-market-title"><Package size={15} /> 专家市场包<small>来自 SkillHub（skillhub.cn/skillspackage）：一键安装整套专家工作流，装完自动在专家中心新增对应专家卡片</small></span>
        <div className="expert-market-tools">
          <div className="expert-market-search"><Search size={13} /><input value={query} placeholder="搜索技能包" onChange={(event) => setQuery(event.target.value)} /></div>
          <button className="icon-button" title="刷新技能包列表" onClick={() => void load()}>{loading ? <Spinner /> : <RefreshCw size={14} />}</button>
        </div>
      </div>
      {items.length > 0 ? <div className="skill-card-grid">
        {items.map((entry) => (
          <article className="skill-card" key={entry.slug} title={entry.summary}>
            <div className="skill-card-head">
              <strong className="expert-market-pack">{entry.displayName}</strong>
              <button className="skill-add" title={`安装「${entry.displayName}」（含 ${entry.children.length} 个子技能）`} disabled={Boolean(installing)} onClick={() => void install(entry)}>{installing === entry.slug ? <Spinner /> : <Plus size={14} />}</button>
            </div>
            <p>{entry.summary}</p>
            <footer><span>{entry.children.length ? `${entry.children.length} 个子技能` : "独立技能"}</span><a href={`https://skillhub.cn/skillspackage`} onClick={(event) => { event.preventDefault(); void window.codex.openExternal("https://skillhub.cn/skillspackage"); }}>查看来源</a></footer>
          </article>
        ))}
      </div> : <p className="muted">{loading ? "正在加载技能包…" : "没有匹配的技能包。"}</p>}
      {pageCount > 1 && <div className="skill-market-pagination">
        <span>共 {total} 个技能包 · 第 {page} / {pageCount} 页</span>
        <div>
          <button className="secondary-setting" disabled={loading || page <= 1} onClick={() => { const next = page - 1; setPage(next); void load(next); }}>上一页</button>
          <button className="secondary-setting" disabled={loading || page >= pageCount} onClick={() => { const next = page + 1; setPage(next); void load(next); }}>下一页</button>
        </div>
      </div>}
      <p className="muted expert-market-note"><Check size={12} /> 安装动作：包元技能与子技能写入技能目录（技能页可见并启停）+ 专家中心新增对应专家卡片，Codex 引擎自动重启加载。</p>
    </div>
  );
}
