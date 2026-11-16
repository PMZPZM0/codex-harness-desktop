/**
 * Craft 全家桶（11-16，storytold/craft-launcher，MIT OR Apache-2.0）—— 开发工具里的三级结构：
 *
 *   层级 1（开发工具页）：一张「Craft 全家桶」卡；
 *   层级 2（本文件主视图）：Launcher 安装/更新/卸载 + 网关状态 + 19 个 App 的网格；
 *   层级 3（每个 App 一个弹窗）：安装状态 / 能做什么 / 怎么用 / 来源，布局与 PhotoCraft 详情一致。
 *      PhotoCraft 那一层直接复用完整的 PhotoCraftCard（自己的工具 / MCP / GUI 入口都在）。
 *
 * ⛔ App 的安装与卸载由 Launcher 自己完成（它处理 UAC 与安装目录）；宿主只装 Launcher。
 * ⛔ 已装状态来自主进程扫描 Launcher 安装目录（status.installedApps）—— 弹窗打开期间每 2.5s
 *    刷新 + 窗口回到前台立刻刷新，用户在 Launcher 里装完回来就能看到「已安装 vX」。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Download, ExternalLink, Palette, Plug, RefreshCw, Trash2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { SettingsDialog } from "../../components/SettingsDialog";
import { RuntimeUpdateRow } from "./RuntimeUpdateRow";
import { PhotoCraftCard } from "./PhotoCraftCard";
import { CRAFT_APPS, craftAppByKey, normalizeCraftKey } from "./artcraft-apps";

type InstalledEntry = { id: string; name: string; dir: string; exePath: string; cliPath: string; version: string };

type Status = {
  installed: boolean;
  version: string;
  launcherPath: string;
  platform: string;
  sizeBytes: number;
  /** Launcher 安装目录里扫到的 App（装完回来自动联动）。 */
  installedApps: InstalledEntry[];
  /** 已写入 config.toml 的独立 MCP 服务器名单（每个 App 一条）。 */
  mcpServers: string[];
  attribution: { license: string; home: string; apps: string };
};

type SuiteProps = {
  setNotice: (text: string, detail?: string) => void;
  installDevRuntime?: (id: string) => void;
  runtimeInstalling?: string | null;
  uninstallDevRuntime?: (id: string) => unknown;
  runtimeUninstalling?: string | null;
  runtimeStage?: Record<string, string>;
  runtimePercent?: Record<string, number> | null;
  runtimeSpeed?: Record<string, string> | null;
  runtimeProgress?: Record<string, string> | null;
  cancelDevRuntime?: (id: string) => unknown;
  setRuntimeModal?: (value: { id?: string; name?: string; mode?: string; done?: boolean; failed?: boolean; error?: string } | null) => void;
};

/** 单个 App 的首字母徽标（层级 2 网格）。 */
function appBadge(name: string): string {
  return name.replace(/Craft$/i, "").slice(0, 1).toUpperCase() || "A";
}

/** Craft 全家桶主视图（开发工具页那张卡的二级弹窗内容）。 */
export function ArtCraftSuite(props: SuiteProps) {
  const { setNotice, installDevRuntime, runtimeInstalling, uninstallDevRuntime, runtimeUninstalling, runtimeStage, runtimePercent, runtimeSpeed, runtimeProgress, cancelDevRuntime, setRuntimeModal } = props;
  const [status, setStatus] = useState<Status | null>(null);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const lastSyncedRef = useRef("");

  const refresh = useCallback(async () => {
    try { setStatus((await window.codex.artcraftStatus()) as Status); } catch { /* 主进程没接上就保持现状 */ }
  }, []);
  /* 弹窗开着就轮询：用户在 Launcher 里装完某个 App，回来这里 2.5s 内变成「已安装」。 */
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2500);
    const onForeground = () => { void refresh(); };
    window.addEventListener("focus", onForeground);
    document.addEventListener("visibilitychange", onForeground);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onForeground);
      document.removeEventListener("visibilitychange", onForeground);
    };
  }, [refresh]);
  useEffect(() => {
    const off = window.codex.onRuntimeProgress((payload: { id?: string; done?: boolean }) => {
      if (payload?.id !== "artcraft" || !payload.done) return;
      void refresh();
    });
    return off;
  }, [refresh]);

  const installing = runtimeInstalling === "artcraft";
  const uninstalling = runtimeUninstalling === "artcraft";
  const percent = Math.round(Number(runtimePercent?.["artcraft"] ?? 0));
  const stage = runtimeStage?.["artcraft"] ?? "";
  const speed = runtimeSpeed?.["artcraft"] ?? "";
  const latest = runtimeProgress?.["artcraft"] ?? "";
  const installFailed = !installing && !uninstalling && /失败/.test(latest);
  const sizeMb = Math.round(Number(status?.sizeBytes ?? 0) / 1048576);
  const installedApps = Array.isArray(status?.installedApps) ? status!.installedApps! : [];
  const installedByKey = new Map(installedApps.map((entry) => [normalizeCraftKey(entry.id), entry]));
  /* 能接成 Codex 工具的 = 带无头 CLI 的已装 App（没有 CLI 的只显示已安装）。 */
  const cliApps = installedApps.filter((entry) => entry.cliPath);

  const openLauncher = async () => {
    setOpening(true);
    try {
      const result = await window.codex.artcraftOpen();
      if (!result?.ok) setNotice("打开 ArtCraft Launcher 失败", result?.error);
    } catch (error) {
      setNotice("打开 ArtCraft Launcher 失败", String((error as Error)?.message ?? error));
    } finally {
      setOpening(false);
    }
  };

  const syncTools = useCallback(async (silent = false) => {
    if (!silent) setSyncing(true);
    try {
      const result = await window.codex.artcraftSync();
      await refresh();
      if (!silent) setNotice("已重新同步 Codex 工具", `已为 ${result?.servers?.length ?? 0} 个已装 App 写入独立 MCP 段；重启应用后引擎才会加载`);
    } catch (error) {
      /* 自动同步失败也要让人看见（最常见原因：还没配置模型，config 无法生成）。 */
      setNotice("Codex 工具自动接入失败", String((error as Error)?.message ?? error));
    } finally {
      if (!silent) setSyncing(false);
    }
  }, [refresh, setNotice]);

  const uninstall = async () => {
    setUninstallOpen(false);
    try {
      await Promise.resolve(uninstallDevRuntime?.("artcraft"));
      setNotice("正在卸载 ArtCraft Launcher", "只删启动器目录与网关段；已装的应用与你的文件不受影响");
    } catch (error) {
      setNotice("卸载失败", String((error as Error)?.message ?? error));
    }
  };

  const app = craftAppByKey(selectedApp);
  const appInstalled = app ? installedByKey.get(normalizeCraftKey(app.key)) : undefined;
  const appToolId = app ? `craft_${app.key.replace(/[^a-z0-9]/g, "")}` : "";
  const appToolReady = Boolean(appInstalled?.cliPath) && (status?.mcpServers ?? []).includes(appInstalled?.id ?? "");

  /* 装完 / 卸完自动同步：已装（带 CLI）名单和已写入的 MCP 名单不一致时，自动重写一次配置。 */
  const withCliKey = installedApps.filter((entry) => entry.cliPath).map((entry) => entry.id).sort().join(",");
  const writtenKey = (status?.mcpServers ?? []).slice().sort().join(",");
  useEffect(() => {
    if (!status?.installed) return;
    if (withCliKey === writtenKey) { lastSyncedRef.current = withCliKey; return; }
    if (lastSyncedRef.current === withCliKey) return;
    lastSyncedRef.current = withCliKey;
    void syncTools(true);
  }, [status?.installed, withCliKey, writtenKey, syncTools]);

  /* 新增接入时给明确反馈：dynamicTools 只在 thread/start（新会话）注入，旧会话不会自动出现。 */
  const lastServerCountRef = useRef(-1);
  useEffect(() => {
    const count = (status?.mcpServers ?? []).length;
    if (lastServerCountRef.current >= 0 && count > lastServerCountRef.current) {
      setNotice(`新增 ${count - lastServerCountRef.current} 个 Codex 工具`, "新开一个会话（或切走再切回本会话）后，模型就能直接调用这些 App 的工具");
    }
    lastServerCountRef.current = count;
  }, [status?.mcpServers, setNotice]);

  return (
    <>
      <section className="settings-section stack feishu-cli-card">
        <div className="feishu-cli-list">
          <div className={`runtime-row ${status?.installed ? "installed" : "missing"} ${installing || uninstalling ? "busy" : ""}`}>
            <span className="runtime-icon">{installing || uninstalling ? <Spinner /> : status?.installed ? <Check size={15} /> : <Download size={15} />}</span>
            <span className="runtime-copy">
              <strong>安装 ArtCraft Launcher</strong>
              <small>
                {uninstalling
                  ? "正在卸载（删除启动器目录并移除网关段；已装的应用不受影响）…"
                  : installing
                    ? "正在下载（约 11 MB，自动选最快的国内镜像并校验 SHA256）…"
                    : status?.installed
                      ? `已安装${status.version ? ` ${status.version}` : ""}${sizeMb ? ` · ${sizeMb} MB` : ""}；用它安装 / 更新 / 打开 19 个创作 App`
                      : "约 11 MB：Craft App Suite 的统一启动器（纯 Rust，MIT/Apache-2.0）；装它一次，其余 App 在它里面按需安装"}
              </small>
              {installing || uninstalling ? (
                <span className="runtime-install-state devtools-progress-row">
                  <span className="runtime-progress-bar" role="progressbar" aria-label="ArtCraft Launcher 安装进度" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                    <i style={{ width: `${percent}%` }} />
                  </span>
                  <em className="runtime-progress">
                    {stage || (uninstalling ? "正在删除启动器目录…" : "正在选择最快的下载源…")}
                    {percent ? ` · ${percent}%` : ""}
                    {!uninstalling && speed ? ` · ${speed}` : ""}
                    {latest && !installFailed ? ` · ${latest}` : ""}
                  </em>
                </span>
              ) : null}
              {installFailed ? (
                <button type="button" className="runtime-failed" onClick={() => setRuntimeModal?.({ id: "artcraft", name: "Craft 全家桶（ArtCraft Launcher）", mode: "install", done: true, failed: true, error: latest.replace(/^安装失败：/, "") })}>
                  <AlertTriangle size={12} />安装失败 · 点开完整报错与备用方案
                </button>
              ) : null}
            </span>
            <div className="runtime-actions">
              {status?.installed ? (
                <>
                  <span className="runtime-badge installed">已安装</span>
                  <button type="button" className="runtime-install feishu-cli-uninstall" disabled={uninstalling} title="卸载 ArtCraft Launcher（弹窗确认）" onClick={() => setUninstallOpen(true)}>
                    {uninstalling ? <><Spinner /> 卸载中</> : <><Trash2 size={13} />卸载</>}
                  </button>
                </>
              ) : uninstalling ? (
                <span className="runtime-badge"><Spinner /> 卸载中</span>
              ) : installing ? (
                <button type="button" className="secondary-setting runtime-cancel" onClick={() => void cancelDevRuntime?.("artcraft")}>取消</button>
              ) : (
                <button type="button" className="primary-setting runtime-install" disabled={Boolean(runtimeInstalling)} onClick={() => installDevRuntime?.("artcraft")}>
                  <Download size={14} />安装
                </button>
              )}
            </div>
          </div>

          <RuntimeUpdateRow
            id="artcraft"
            installed={Boolean(status?.installed)}
            hint="从 GitHub release 镜像序拉新版 Launcher 并 SHA256SUMS 校验；只换启动器，已装应用与配置不受影响"
            runtimeStage={runtimeStage}
            runtimePercent={runtimePercent}
            runtimeSpeed={runtimeSpeed}
            runtimeProgress={runtimeProgress}
            cancelDevRuntime={cancelDevRuntime}
            onUpdated={refresh}
          />

          <div className={`runtime-row ${status?.mcpServers?.length ? "installed" : "missing"}`}>
            <span className="runtime-icon"><Plug size={15} /></span>
            <span className="runtime-copy">
              <strong>Codex 工具（每个 App 独立）</strong>
              <small>
                {!status?.installed
                  ? "装好 Launcher 后，已在 Launcher 里安装的 App 会自动各接一个独立工具"
                  : status.mcpServers?.length
                    ? `已接入 ${status.mcpServers.length} 个：${status.mcpServers.join(" / ")}；新开会话（或切回本会话）后模型可直接调用`
                    : cliApps.length
                      ? `已检测到 ${cliApps.length} 个 App，正在写入配置（需要先在模型页配置一个可用模型）`
                      : "还没检测到已装 App —— 去 Launcher 装一个，回来这里会自动接入"}
              </small>
            </span>
            <div className="runtime-actions">
              <span className={`runtime-badge ${status?.mcpServers?.length ? "installed" : ""}`}>
                {status?.mcpServers?.length ? `已接入 ${status.mcpServers.length} 个` : cliApps.length ? "待写入配置" : "等待安装 App"}
              </span>
              {status?.installed ? (
                <button type="button" className="secondary-setting runtime-install" disabled={syncing} onClick={() => void syncTools()}>
                  {syncing ? <><Spinner /> 同步中</> : <><RefreshCw size={13} />重新同步</>}
                </button>
              ) : null}
            </div>
          </div>

          <div className={`runtime-row ${status?.installed ? "installed" : "missing"}`}>
            <span className="runtime-icon"><Palette size={15} /></span>
            <span className="runtime-copy">
              <strong>打开 Launcher</strong>
              <small>{status?.installed ? "安装 / 更新 / 打开任意创作 App 都在 Launcher 里完成；装完回到这里会自动显示「已安装」" : "装好 Launcher 后可以在这里直接打开"}</small>
            </span>
            <div className="runtime-actions">
              {status?.installed ? (
                <button type="button" className="secondary-setting runtime-install" disabled={opening} onClick={() => void openLauncher()}>
                  {opening ? <><Spinner /> 打开中</> : "打开 Launcher"}
                </button>
              ) : (
                <span className="runtime-badge">安装后可用</span>
              )}
            </div>
          </div>
        </div>

        <section className="feishu-cli-guide">
          <div className="feishu-cli-guide-head">
            <strong>套件里的 App（{CRAFT_APPS.length}）</strong>
            <small>点任意一个看它能做什么；装好后每个 App 各自接一个独立 Codex 工具（PhotoCraft 用它自己的 photocraft 工具）</small>
          </div>
          <div className="craft-app-grid">
            {CRAFT_APPS.map((item) => {
              const installed = installedByKey.get(normalizeCraftKey(item.key));
              return (
                <button type="button" className="craft-app-tile" key={item.key} onClick={() => setSelectedApp(item.key)} aria-label={`查看 ${item.name}`}>
                  <span className="craft-app-badge" style={{ background: `${item.color}22`, color: item.color }}>{appBadge(item.name)}</span>
                  <span className="craft-app-copy">
                    <strong>{item.name}</strong>
                    <small>{item.zh}</small>
                  </span>
                  {installed ? <span className="craft-app-tag is-installed">已安装</span> : item.integrated ? <span className="craft-app-tag">已接入</span> : null}
                </button>
              );
            })}
          </div>

          <ul className="feishu-cli-notes">
            <li>上游项目标记 early alpha：安装与应用版本由 Launcher 自己管理，本卡只负责装 / 更 / 打开 Launcher。</li>
            <li>⛔ 本应用只下载官方 GitHub release 的便携包（镜像序 + SHA256SUMS 校验），不重打包、不搬源码、不冒充 ArtCraft 官方。</li>
            <li>工具按 App 拆开：每个已装 App 各自一条 MCP 段 + 一个独立工具（便于区分）；装/卸后本卡自动同步配置。</li>
          </ul>
        </section>

        {status?.attribution && (
          <div className="runtime-row installed">
            <span className="runtime-icon"><ExternalLink size={15} /></span>
            <span className="runtime-copy">
              <strong>来源与许可</strong>
              <small>{status.attribution.license} · {status.attribution.home}</small>
            </span>
            <div className="runtime-actions">
              <button type="button" className="secondary-setting runtime-install" onClick={() => void window.codex.openExternal(status.attribution.apps)}>套件主页</button>
            </div>
          </div>
        )}
      </section>

      {uninstallOpen && (
        <SettingsDialog title="卸载 ArtCraft Launcher？" icon={<Trash2 size={15} />} hint="只删启动器目录与网关段；已装的应用与你的文件不受影响" size="sm" onClose={() => setUninstallOpen(false)}>
          <div className="settings-section stack">
            <p className="settings-hint">卸载后 Launcher 里装的 App 仍在原处，但本卡不能再打开它们；重新安装即可恢复。确认卸载？</p>
            <div className="settings-actions">
              <button type="button" className="secondary-setting" onClick={() => setUninstallOpen(false)}>取消</button>
              <button type="button" className="primary-setting danger" onClick={() => void uninstall()}>卸载</button>
            </div>
          </div>
        </SettingsDialog>
      )}

      {app && (
        <SettingsDialog
          title={app.name}
          icon={<Palette size={15} />}
          hint={`${app.zh}${app.integrated ? " · 已接入 Codex" : ""}${app.community ? " · 社区维护" : ""}`}
          size={app.integrated ? "md" : "md"}
          onClose={() => setSelectedApp(null)}
        >
          {app.integrated ? (
            <PhotoCraftCard
              setNotice={setNotice}
              installDevRuntime={installDevRuntime}
              runtimeInstalling={runtimeInstalling}
              uninstallDevRuntime={uninstallDevRuntime}
              runtimeUninstalling={runtimeUninstalling}
              runtimeStage={runtimeStage}
              runtimePercent={runtimePercent}
              runtimeSpeed={runtimeSpeed}
              runtimeProgress={runtimeProgress}
              cancelDevRuntime={cancelDevRuntime}
              setRuntimeModal={setRuntimeModal}
            />
          ) : (
            <section className="settings-section stack feishu-cli-card">
              <div className="feishu-cli-list">
                <div className={`runtime-row ${appInstalled ? "installed" : "missing"}`}>
                  <span className="runtime-icon">{appInstalled ? <Check size={15} /> : <Download size={15} />}</span>
                  <span className="runtime-copy">
                    <strong>{appInstalled ? "已安装" : "安装"}</strong>
                    <small>
                      {appInstalled
                        ? `已装${appInstalled.version ? ` v${appInstalled.version}` : ""}；点右侧用 Launcher 打开它（装完/更新后这里会自动刷新）`
                        : `应用由 Launcher 下载安装（它自己处理安装目录与 UAC）${app.sizeMb ? `；Windows 便携包约 ${app.sizeMb} MB` : ""}`}
                    </small>
                  </span>
                  <div className="runtime-actions">
                    <button type="button" className="primary-setting runtime-install" disabled={opening || !status?.installed} onClick={() => void openLauncher()}>
                      {opening ? <><Spinner /> 打开中</> : appInstalled ? "在 Launcher 中打开" : "在 Launcher 中安装"}
                    </button>
                  </div>
                </div>
                <div className="runtime-row installed">
                  <span className="runtime-icon"><RefreshCw size={15} /></span>
                  <span className="runtime-copy">
                    <strong>更新</strong>
                    <small>在 Launcher 里点「检查更新」；回到这里状态会自动同步</small>
                  </span>
                  <div className="runtime-actions"><span className="runtime-badge">由 Launcher 管理</span></div>
                </div>
                <div className={`runtime-row ${appToolReady ? "installed" : "missing"}`}>
                  <span className="runtime-icon"><Plug size={15} /></span>
                  <span className="runtime-copy">
                    <strong>Codex 工具（独立）</strong>
                    <small>
                      {appToolReady
                        ? `${appToolId}：每个 App 一条独立 MCP 段，便于区分；重启应用后可在 Codex 里直接调用`
                        : appInstalled
                          ? (appInstalled.cliPath ? "已装，等下一次同步后接入" : "这个 App 没有无头 CLI，暂不提供 Codex 工具")
                          : "装好后自动接入（每个 App 一个独立工具）"}
                    </small>
                  </span>
                  <div className="runtime-actions">
                    <span className={`runtime-badge ${appToolReady ? "installed" : ""}`}>{appToolReady ? "已接入" : appInstalled ? "待同步" : "装后可用"}</span>
                  </div>
                </div>
              </div>

              <section className="feishu-cli-guide">
                <div className="feishu-cli-guide-head">
                  <strong>能做什么</strong>
                  <small>{app.desc}</small>
                </div>
                <div className="feishu-cli-cap-grid">
                  {app.features.slice(0, 4).map((feature) => (
                    <div className="feishu-cli-cap" key={feature}>
                      <span className="feishu-cli-cap-icon"><Check size={15} /></span>
                      <span className="feishu-cli-cap-copy"><strong>{feature}</strong></span>
                    </div>
                  ))}
                </div>

                <div className="feishu-cli-guide-head">
                  <strong>怎么用</strong>
                  <small>三步：装、开、各自接一个工具</small>
                </div>
                <ol className="feishu-cli-guide-steps">
                  <li><b>在 Launcher 里安装</b><span>这里只负责把 Launcher 打开；安装目录与 UAC 由它处理。</span></li>
                  <li><b>装完回来自动显示「已安装」</b><span>看到版本号后直接点「在 Launcher 中打开」进入应用。</span></li>
                  <li><b>各自一个 Codex 工具</b><span>每个已装 App 单独接一条 MCP 段（{appToolId}），不会和别的 App 混在一起。</span></li>
                </ol>

                <ul className="feishu-cli-notes">
                  <li>项目处于 early alpha：功能与界面随上游变化，版本在 Launcher 里更新。</li>
                  <li>数据与文件都在本机；本应用不代装、不代卸这些 App。</li>
                  <li>⛔ 本应用不是 ArtCraft 官方产品；只下载官方发行物，不重打包、不冒充品牌。</li>
                </ul>
              </section>

              <div className="runtime-row installed">
                <span className="runtime-icon"><ExternalLink size={15} /></span>
                <span className="runtime-copy">
                  <strong>来源与许可</strong>
                  <small>MIT OR Apache-2.0 · {app.repo.replace(/^https:\/\//, "")}</small>
                </span>
                <div className="runtime-actions">
                  <button type="button" className="secondary-setting runtime-install" onClick={() => void window.codex.openExternal(app.repo)}>GitHub</button>
                  {app.site ? <button type="button" className="secondary-setting runtime-install" onClick={() => void window.codex.openExternal(app.site as string)}>官网</button> : null}
                </div>
              </div>
            </section>
          )}
        </SettingsDialog>
      )}
    </>
  );
}
