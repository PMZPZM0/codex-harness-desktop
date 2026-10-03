/**
 * Codex 官方插件市场（GitHub `openai/plugins`，国内镜像读取）—— 插件页的**第二个数据源**。
 *
 * ⛔ 自包含：所有状态都是本地 useState（照 `component-library` 页的先例），不进 bag。
 *   理由：这个板块的列表/分页/搜索/安装进度只有本页消费，挂 bag 要动 1,400 项的 `bag-types.ts`
 *   生成物（生成器已随原始大文件一起不存在，只能手写登记），代价远大于收益。
 *   唯一对外的口子 = `onResourcesChanged`（装完/卸完让宿主刷一次「已安装」区）。
 *
 * 三件必须说清的事（用户原话：「安装状态反馈和已安装反馈」）：
 *   1. **安装中**：复用 `PluginInstallModal` 六步进度（与 Gitee 源同一套 DOM/CSS），
 *      事件走 `official-plugin-install`（⛔ 不与 `plugin-install` 共用 type —— 两个源有重名 slug：
 *      linear / github 都撞，共用会让弹层认错插件）。
 *   2. **已安装**：判定取主进程本地 marker（真相源），不是引擎 plugin/list；
 *      卡片右上角 ✓，点 ✓ 走**两段式确认**再卸载（删除不可逆，第二次点击才真删）。
 *   3. **装了不等于能用**：官方 65 条**全部要鉴权**（ON_INSTALL 58 / ON_USE 7），
 *      其中 15 条还依赖 ChatGPT 应用连接器 ⇒ 每张卡片都带 `authNote`，
 *      外部仓库源那 3 条直接标「不支持一键安装」，不给人点了才发现报错。
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { SearchField } from "../../components/SettingsWidgets";
import { MarketLogo, PluginInstallModal } from "../skills-market";

type Props = { onResourcesChanged?: () => void };
type Category = { key: string; displayName: string; count: number };
/** 弹层六步的落点（与 part05 里 `plugin-install` 的口径逐字一致，两个源共用同一张进度条） */
const STAGE_POSITIONS: Record<string, number> = { resolve: 1, download: 2, install: 3, register: 4, engine: 5, verify: 6, complete: 7, pending: 7 };
const PAGE_SIZE = 18;

export function CodexOfficialMarketSection({ onResourcesChanged }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState("全部");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  const [live, setLive] = useState(true);
  const [snapshotAt, setSnapshotAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState("");
  const [install, setInstall] = useState<{ plugin: any; current: number; failed?: string; engineRegistered?: boolean; engineCheckMessage?: string } | null>(null);
  const [confirmSlug, setConfirmSlug] = useState("");
  const [uninstalling, setUninstalling] = useState("");
  const [notice, setNotice] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result: any = await window.codex.listOfficialMarketPlugins({ category, query, page, pageSize: PAGE_SIZE });
      setItems(result.items ?? []);
      setTotal(result.total ?? 0);
      setInstalledIds(result.installedIds ?? []);
      setLive(result.live !== false);
      setSnapshotAt(result.catalogGeneratedAt ?? "");
      setError("");
    } catch (cause: any) {
      // ⛔ 失败必须可见：静默空列表会被当成「官方源没有插件」
      setError(`官方插件市场加载失败：${cause?.message ?? cause}`);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [category, query, page]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    let disposed = false;
    void window.codex.listOfficialMarketCategories()
      .then((list: any) => { if (!disposed) setCategories(list ?? []); })
      .catch(() => undefined);
    return () => { disposed = true; };
  }, []);

  // 安装进度：主进程每个阶段广播一次，这里只推弹层（按 slug 认领，忽略别的源/别的插件的事件）
  useEffect(() => window.codex.onHarnessEvent((event: any) => {
    if (event?.type !== "official-plugin-install") return;
    setInstall((current) => {
      if (!current || current.plugin.slug !== event.pluginId) return current;
      return {
        ...current,
        current: Math.max(current.current, STAGE_POSITIONS[event.stage] ?? current.current),
        engineRegistered: event.stage === "complete" ? true : current.engineRegistered,
        engineCheckMessage: event.stage === "complete" || event.stage === "pending" ? event.message : current.engineCheckMessage,
      };
    });
  }), []);

  const installPlugin = async (plugin: any) => {
    if (!plugin.installable || installing) return;
    setInstalling(plugin.slug);
    setNotice("");
    setInstall({ plugin: { slug: plugin.slug, displayName: plugin.displayName }, current: 1 });
    try {
      const result: any = await window.codex.installOfficialMarketPlugin(plugin);
      setInstall((current) => current ? {
        ...current,
        current: 7,
        engineRegistered: Boolean(result?.engineRegistered),
        engineCheckMessage: result?.engineCheckMessage ?? "插件目录已写入，重启 Codex 后生效",
      } : current);
      await reload();
      onResourcesChanged?.();
    } catch (cause: any) {
      setInstall((current) => current ? { ...current, failed: cause?.message ?? String(cause) } : current);
    } finally {
      setInstalling("");
    }
  };

  const uninstallPlugin = async (plugin: any) => {
    if (confirmSlug !== plugin.slug) { setConfirmSlug(plugin.slug); return; }   // 两段式：第一次只武装确认条
    setUninstalling(plugin.slug);
    try {
      const result: any = await window.codex.uninstallOfficialMarketPlugin(plugin.slug);
      setNotice(result?.ok ? `已卸载 ${plugin.displayName}${result.engineRemoved ? "（引擎已同步停用）" : "（引擎将在下次扫描后同步）"}` : `卸载失败：${result?.reason ?? "未知原因"}`);
      await reload();
      onResourcesChanged?.();
    } catch (cause: any) {
      setNotice(`卸载失败：${cause?.message ?? cause}`);
    } finally {
      setUninstalling("");
      setConfirmSlug("");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const tabs: [string, string][] = [["全部", "全部"], ...categories.map((entry) => [entry.displayName, entry.key] as [string, string])];

  return <div className="plugin-market-block codex-official-market">
    <div className="plugin-market-title">Codex 官方插件市场
      <small>来自 GitHub <code>openai/plugins</code>（Codex 官方市场原档）· 走国内镜像下载 · {total} 个官方插件，其中已安装 {installedIds.length} 个</small>
    </div>
    {error && <p className="codex-official-market-error">{error}<button className="secondary-setting" onClick={() => void reload()}>重试</button></p>}
    {!error && !live && <p className="codex-official-market-note">暂时连不上上游，下面的列表来自<b>内置快照</b>（{snapshotAt || "日期未知"}）· 已安装状态仍读本地目录，不受影响。</p>}
    <div className="resource-toolbar">
      <div className="skill-tabs">{tabs.map(([label, value]) => <button key={value} className={category === value ? "active" : ""} onClick={() => { setCategory(value); setPage(1); }}>{label}</button>)}</div>
      <SearchField value={query} onChange={(next) => { setQuery(next); setPage(1); }} placeholder="搜索官方插件名称、简介或分类" />
    </div>
    {notice && <p className="codex-official-market-note">{notice}</p>}
    {items.length > 0 ? <div className="skill-card-grid">
      {items.map((plugin: any) => {
        const installed = plugin.installed === true || installedIds.includes(plugin.slug);
        const busy = installing === plugin.slug;
        const confirming = confirmSlug === plugin.slug;
        return <article className={`skill-card codex-official-market-card ${installed ? "installed" : ""}`} key={plugin.slug}>
          <div className="skill-card-head">
            <MarketLogo url={plugin.logo} label={plugin.displayName} size={30} />
            {installed ? <span className="codex-official-market-state">
              <span className="codex-official-market-flag" title={`已安装${plugin.installedVersion ? ` v${plugin.installedVersion}` : ""}（真相源：本地插件目录里的来源清单）`}><Check size={13} />已安装</span>
              <button
                className={`codex-official-market-remove ${confirming ? "armed" : ""}`}
                title={confirming ? "再次点击确认卸载（会删除本地插件目录）" : "卸载：删除本地插件目录"}
                disabled={uninstalling === plugin.slug}
                onClick={() => void uninstallPlugin(plugin)}
              >{uninstalling === plugin.slug ? <Spinner /> : <Trash2 size={14} />}</button>
            </span> : <button
              className="skill-add"
              title={plugin.installable ? "一键安装到本地插件目录（国内镜像）" : plugin.unavailableReason ?? "暂不支持一键安装"}
              disabled={!plugin.installable || Boolean(installing)}
              onClick={() => void installPlugin(plugin)}
            >{busy ? <Spinner /> : <Plus size={14} />}</button>}
          </div>
          <strong title={plugin.slug}>{plugin.displayName}</strong>
          <p>{plugin.description}</p>
          {/* ⛔ 鉴权提示不许省：官方 65 条全部要配凭据，只报「已安装」等于骗人 */}
          <em className="codex-official-market-auth"><ShieldCheck size={12} />{plugin.authNote}</em>
          {confirming && <div className="codex-official-market-confirm">
            <span>确认卸载？将删除本地插件目录 <code>plugins/{plugin.slug}</code>，需重新联网安装。</span>
            <button className="primary-setting" onClick={() => void uninstallPlugin(plugin)}>确认卸载</button>
            <button className="secondary-setting" onClick={() => setConfirmSlug("")}>取消</button>
          </div>}
          <footer>
            <span>{plugin.categoryZh ?? plugin.category}</span>
            {plugin.version && <span title="上游版本">v{plugin.version}</span>}
            {!plugin.installable && <span className="codex-official-market-external">外部源</span>}
            <a href={plugin.homepage} onClick={(event) => { event.preventDefault(); void window.codex.openExternal(plugin.homepage); }}>查看来源</a>
          </footer>
        </article>;
      })}
    </div> : !loading && <p className="muted">{error ? "上面的错误修复后重试即可。" : "没有匹配的官方插件，换个关键词或分类试试。"}</p>}
    {loading && !items.length && <p className="muted">正在加载 Codex 官方插件市场…</p>}
    <div className="skill-market-pagination">
      <span>共 {total} 个官方插件 · 第 {page} / {totalPages} 页{installedIds.length ? ` · 已安装 ${installedIds.length} 个` : ""}</span>
      <div>
        <button className="secondary-setting" disabled={loading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button>
        <button className="secondary-setting" disabled={loading || page >= totalPages} onClick={() => setPage((current) => current + 1)}>下一页</button>
      </div>
    </div>
    {install && <PluginInstallModal state={install as any} onClose={() => { setInstall(null); setConfirmSlug(""); }} />}
  </div>;
}
