/**
 * 人格市场（soul-market 域，2026-10-01 立项）：SkillHub 人格（skillhub.cn/soul，16 套）。
 * 生效机制：应用 = 主进程把人设写进 personalization.json 的 persona 字段并同步 $CODEX_HOME/AGENTS.md，
 * 引擎每个会话动态重读该文件 ⇒ **下一个新会话即生效**，无需重启引擎；已开着的会话不受影响。
 * 自带数据面（列表/详情/当前生效在组件内），与组件库页同款自包含形态。
 * ⛔ 加载失败必须可见（comp-lib-error 同款教训：不许静默空白）。
 * 10-01 用户反馈两连：①点「看人设详情」没反应——原实现是页面底部内嵌展开，折叠在视口外看不见
 *   ⇒ 改成**真弹窗**（info-modal 体系，与侧栏弹窗同款）；②「怎么检查我的人格生效没」
 *   ⇒ 页头加「当前生效」状态卡：当前人格名 + persona 是否已写入档案 + 生效时点说明。
 */
import { useEffect, useState } from "react";
import { Check, RefreshCw, UserRound, X } from "lucide-react";
import { PageInfo } from "../../components/SettingsHead";
import { Spinner } from "../../components/CardShell";

type SoulEntry = { slug: string; displayName: string; summary: string; version: string };
type SoulDetail = SoulEntry & { content: string };

export type SoulMarketSectionProps = { onNotice: (message: string) => void };

export function SoulMarketSection({ onNotice }: SoulMarketSectionProps) {
  const [items, setItems] = useState<SoulEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeSlug, setActiveSlug] = useState("");
  const [activePersona, setActivePersona] = useState("");
  const [preview, setPreview] = useState<SoulDetail | null>(null);
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
      setActivePersona(String(current.persona ?? ""));
    } catch (err: any) {
      setError(err?.message ?? String(err));
      onNotice(`人格市场读取失败：${err?.message ?? err}`);
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const openPreview = async (entry: SoulEntry) => {
    setDetailLoading(entry.slug);
    try {
      const detail = await window.codex.getSoulMarket({ slug: entry.slug });
      setPreview(detail);
    } catch (err: any) {
      setError(`人格详情获取失败：${err?.message ?? err}`);
      onNotice(`人格详情获取失败：${err?.message ?? err}`);
    }
    finally { setDetailLoading(""); }
  };

  const apply = async (slug: string | null) => {
    setBusy(slug ?? "__reset__");
    try {
      const result = await window.codex.applySoulMarket({ slug });
      setActiveSlug(result.slug ?? "");
      setActivePersona(slug == null ? "" : (preview?.content ?? activePersona));
      setApplied(slug == null ? "已还原默认人格，下一个新会话生效" : `已应用「${result.displayName}」，下一个新会话生效`);
      onNotice(slug == null ? "已还原默认人格，下一个新会话生效" : `✅ 已应用人格「${result.displayName}」——下一个新会话生效`);
      setPreview(null);
    } catch (err: any) {
      onNotice(`❌ 人格应用失败：${err?.message ?? err}`);
      setError(`应用失败：${err?.message ?? err}`);
    }
    finally { setBusy(""); }
  };

  const activeEntry = items.find((entry) => entry.slug === activeSlug);
  return (
    <section className="settings-section stack soul-market">
      <div className="settings-copy"><h2>人格市场<PageInfo text={<>来自 SkillHub（skillhub.cn/soul）的现成人格：选一个装上，Codex 的性格、语气、说话风格就换成 TA。生效方式 = 写入全局个性化并同步引擎的 AGENTS.md，<b>下一个新会话开始生效</b>（不用重启应用；正开着的会话保持原样）。「还原默认」随时退回。</>} helpKey="soul-market" label="人格市场" /></h2></div>

      {/* 当前生效状态卡（10-01 用户：「怎么检查我的人格是否生效」）：persona 落了档 = 已写入；
          生效时点 = 下一个新会话。persona 有内容但 slug 为空 = 用户在个性化里手填过，同样算生效。 */}
      <div className={`soul-market-status${activeSlug ? " active" : ""}`}>
        <span className="soul-market-avatar"><UserRound size={16} /></span>
        <div className="soul-market-status-main">
          <strong>{activeEntry ? `${activeEntry.displayName}（生效中）` : activePersona ? "自定义人格（生效中）" : "默认人格"}</strong>
          <small>{activePersona
            ? `人设已写入全局个性化并同步引擎 AGENTS.md（${activePersona.length} 字）；新开的会话自动带上这套人设，正开着的会话不受影响。`
            : "还没有应用人格——Codex 按默认风格对话。点下面任意人格卡片的「应用」即可换上。"}</small>
        </div>
        {(activeSlug || activePersona) && <button className="secondary-setting" disabled={Boolean(busy)} onClick={() => void apply(null)}>{busy === "__reset__" ? <Spinner /> : null}还原默认人格</button>}
      </div>

      {error && <p className="soul-market-error comp-lib-error">⚠️ {error}</p>}
      <div className="settings-heading-actions">
        <button className="secondary-setting" title="刷新人格列表与生效状态" onClick={() => void load()}>{loading ? <Spinner /> : <RefreshCw size={14} />}刷新</button>
      </div>

      {applied && <p className="muted soul-market-applied"><Check size={12} /> {applied}</p>}

      {loading ? <p className="muted">正在加载人格列表…</p> : items.length === 0 ? (
        <p className="muted">人格列表为空（SkillHub 共 16 套，加载失败时看上方错误提示）。</p>
      ) : (
        <div className="soul-market-grid">
          {items.map((entry) => {
            const active = entry.slug === activeSlug;
            return (
              <article key={entry.slug} className={`soul-market-card${active ? " active" : ""}`} onClick={() => void openPreview(entry)} title="点击查看人设全文并应用">
                <div className="soul-market-card-head">
                  <span className="soul-market-avatar"><UserRound size={16} /></span>
                  <strong>{entry.displayName}</strong>
                  {active && <i className="soul-market-badge">生效中</i>}
                </div>
                <p>{entry.summary}</p>
                <footer>
                  <span>v{entry.version || "1.0.0"}</span>
                  {detailLoading === entry.slug ? <Spinner /> : <em>看人设全文</em>}
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {/* 人设全文弹窗（info-modal 体系，与侧栏弹窗同款；⛔ 不是页面内嵌——用户截图反馈内嵌看不见） */}
      {preview && (
        <div className="info-modal-mask" onClick={() => setPreview(null)}>
          <div className="info-modal soul-market-modal" role="dialog" aria-label={`${preview.displayName} 人设预览`} onClick={(event) => event.stopPropagation()}>
            <header>
              <UserRound size={15} className="info-modal-icon" />
              <strong>{preview.displayName}</strong>
              {preview.slug === activeSlug && <i className="soul-market-badge">生效中</i>}
              <button title="关闭" onClick={() => setPreview(null)}><X size={14} /></button>
            </header>
            <pre className="soul-market-content">{preview.content}</pre>
            <footer className="soul-market-modal-actions">
              <span className="muted">应用后下一个新会话生效；正开着的会话保持原样</span>
              <button className="secondary-setting" disabled={Boolean(busy)} onClick={() => void apply(preview.slug)}>{busy === preview.slug ? <Spinner /> : <Check size={13} />}{preview.slug === activeSlug ? "重新应用" : "应用此人格"}</button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
