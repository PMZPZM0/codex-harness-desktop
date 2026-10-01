/**
 * 人格市场（soul-market 域，2026-10-01 立项）：SkillHub 人格（skillhub.cn/soul，16 套）。
 * 生效机制：应用 = 主进程把人设写进 personalization.persona 并同步 $CODEX_HOME/AGENTS.md，
 * 引擎每个会话动态重读该文件 ⇒ **下一个新会话即生效**，无需重启引擎；已开着的会话不受影响。
 * 自带数据面（列表/详情/当前生效在组件内），与组件库页同款自包含形态。
 * ⛔ 加载失败必须可见（comp-lib-error 同款教训：不许静默空白）。
 */
import { useEffect, useState } from "react";
import { Check, RefreshCw, UserRound } from "lucide-react";
import { PageInfo } from "../../components/SettingsHead";
import { Spinner } from "../../components/CardShell";

type SoulEntry = { slug: string; displayName: string; summary: string; version: string };
type SoulDetail = SoulEntry & { content: string };

export function SoulMarketSection() {
  const [items, setItems] = useState<SoulEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeSlug, setActiveSlug] = useState("");
  const [selected, setSelected] = useState<SoulDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState("");
  const [busy, setBusy] = useState("");
  const [applied, setApplied] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [list, current] = await Promise.all([
        window.codex.listSoulMarket(),
        window.codex.currentSoulMarket(),
      ]);
      setItems(list.items);
      setActiveSlug(current.soulSlug ?? "");
    } catch (err: any) { setError(err?.message ?? String(err)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const openDetail = async (entry: SoulEntry) => {
    if (selected?.slug === entry.slug) { setSelected(null); return; }
    setDetailLoading(entry.slug);
    try {
      const detail = await window.codex.getSoulMarket({ slug: entry.slug });
      setSelected(detail);
    } catch (err: any) { setError(`人格详情获取失败：${err?.message ?? err}`); }
    finally { setDetailLoading(""); }
  };

  const apply = async (slug: string | null) => {
    setBusy(slug ?? "__reset__");
    try {
      const result = await window.codex.applySoulMarket({ slug });
      setActiveSlug(result.slug ?? "");
      setApplied(slug == null ? "已还原默认人格，下一个新会话生效" : `已应用「${result.displayName}」，下一个新会话生效`);
      setSelected(null);
    } catch (err: any) { setError(`应用失败：${err?.message ?? err}`); }
    finally { setBusy(""); }
  };

  return (
    <section className="settings-section stack soul-market">
      <div className="settings-copy"><h2>人格市场<PageInfo text={<>来自 SkillHub（skillhub.cn/soul）的现成人格：选一个装上，Codex 的性格、语气、说话风格就换成 TA。生效方式 = 写入全局个性化并同步引擎的 AGENTS.md，<b>下一个新会话开始生效</b>（不用重启应用；正开着的会话保持原样）。「还原默认」随时退回。</>} helpKey="soul-market" label="人格市场" /></h2></div>

      {error && <p className="soul-market-error comp-lib-error">⚠️ {error}</p>}
      <div className="settings-heading-actions">
        <button className="secondary-setting" title="刷新人格列表" onClick={() => void load()}>{loading ? <Spinner /> : <RefreshCw size={14} />}刷新</button>
        {activeSlug && <button className="secondary-setting" disabled={Boolean(busy)} onClick={() => void apply(null)}>{busy === "__reset__" ? <Spinner /> : null}还原默认人格</button>}
      </div>

      {applied && <p className="muted soul-market-applied"><Check size={12} /> {applied}</p>}

      {loading ? <p className="muted">正在加载人格列表…</p> : items.length === 0 ? (
        <p className="muted">人格列表为空（SkillHub 共 16 套，加载失败时看上方错误提示）。</p>
      ) : (
        <div className="soul-market-grid">
          {items.map((entry) => {
            const active = entry.slug === activeSlug;
            return (
              <article key={entry.slug} className={`soul-market-card${active ? " active" : ""}`} onClick={() => void openDetail(entry)}>
                <div className="soul-market-card-head">
                  <span className="soul-market-avatar"><UserRound size={16} /></span>
                  <strong>{entry.displayName}</strong>
                  {active && <i className="soul-market-badge">生效中</i>}
                </div>
                <p>{entry.summary}</p>
                <footer>
                  <span>v{entry.version || "1.0.0"}</span>
                  {detailLoading === entry.slug ? <Spinner /> : <em>{selected?.slug === entry.slug ? "收起" : "看人设详情"}</em>}
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="soul-market-detail">
          <div className="soul-market-detail-head">
            <strong>{selected.displayName} 的人设全文</strong>
            <button className="secondary-setting" disabled={Boolean(busy)} onClick={() => void apply(selected.slug)}>{busy === selected.slug ? <Spinner /> : <Check size={13} />}{activeSlug === selected.slug ? "重新应用" : "应用此人格"}</button>
          </div>
          <pre className="soul-market-content">{selected.content}</pre>
        </div>
      )}
    </section>
  );
}
