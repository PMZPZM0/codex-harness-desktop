/**
 * Craft 全家桶（11-16，storytold/craft-launcher，MIT OR Apache-2.0）—— 开发工具里的三级结构：
 *
 *   层级 1（开发工具页）：一张「Craft 全家桶」卡；
 *   层级 2（本文件主视图）：Launcher 安装/更新/卸载 + 网关状态 + 19 个 App 的网格；
 *   层级 3（每个 App 一个弹窗）：用途 / 体积 / 来源 / 打开 Launcher 安装；
 *      PhotoCraft 那一层直接复用完整的 PhotoCraftCard（自己的工具 / MCP / GUI 入口都在）。
 *
 * ⛔ App 的安装与卸载由 Launcher 自己完成（它处理 UAC 与安装目录）；宿主只装 Launcher，
 *    不代装、不代卸 19 个创作 App。
 * ⛔ 11-16 实测：上游 v0.19.2 便携包里**没有** craft-ai-mcp 网关（代码只在 main 分支）
 *    ⇒ 网关状态如实显示「等待 Launcher 新版」，只有真的检测到二进制才允许写入 MCP 段。
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Download, ExternalLink, Palette, Plug, RefreshCw, Trash2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { SettingsDialog } from "../../components/SettingsDialog";
import { copyTextToClipboard } from "../../lib/clipboard";
import { RuntimeUpdateRow } from "./RuntimeUpdateRow";
import { PhotoCraftCard } from "./PhotoCraftCard";
import { CRAFT_APPS, craftAppByKey } from "./artcraft-apps";

type Status = {
  installed: boolean;
  version: string;
  launcherPath: string;
  gatewayPath: string;
  gatewayReady: boolean;
  mcpRegistered: boolean;
  configSnippet: string;
  platform: string;
  sizeBytes: number;
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

  const refresh = useCallback(async () => {
    try { setStatus((await window.codex.artcraftStatus()) as Status); } catch { /* 主进程没接上就保持现状 */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
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

  const syncGateway = async () => {
    setSyncing(true);
    try {
      const result = await window.codex.artcraftSync();
      await refresh();
      if (!result?.gatewayReady) {
        setNotice("还没检测到 craft-ai-mcp 网关", "当前 Launcher 版本还没随包提供网关；等新版发布后点「重新检测」即可");
      } else if (result.mcpRegistered) {
        setNotice("已写入 [mcp_servers.ArtCraft]", "重启应用后引擎才会加载这个网关（一个入口覆盖所有已装 App）");
      } else {
        setNotice("网关已就绪但配置未写入", "请确认已配置模型后再点一次；日志见设置 → 数据");
      }
    } catch (error) {
      setNotice("写入配置失败", String((error as Error)?.message ?? error));
    } finally {
      setSyncing(false);
    }
  };

  const copySnippet = async () => {
    if (!status?.configSnippet) return;
    await copyTextToClipboard(status.configSnippet);
    setNotice("已复制 Codex 配置片段", "相当于 Launcher「设置 → AI agents」里复制的那一段");
  };

  const uninstall = async () => {
    setUninstallOpen(false);
    try {
      await Promise.resolve(uninstallDevRuntime?.("artcraft"));
      setNotice("正在卸载 ArtCraft Launcher", "只删启动器目录与 [mcp_servers.ArtCraft] 段；已装的应用与你的文件不受影响");
    } catch (error) {
      setNotice("卸载失败", String((error as Error)?.message ?? error));
    }
  };

  const app = craftAppByKey(selectedApp);
  const gatewayBadge = !status?.installed
    ? "安装后检测"
    : status.gatewayReady
      ? (status.mcpRegistered ? "已注册" : "就绪 · 待写入")
      : "等待 Launcher 新版";

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

          <div className={`runtime-row ${status?.gatewayReady ? "installed" : "missing"}`}>
            <span className="runtime-icon"><Plug size={15} /></span>
            <span className="runtime-copy">
              <strong>Codex 网关（一个入口驱动全部已装 App）</strong>
              <small>
                {!status?.installed
                  ? "装好 Launcher 后宿主会检测上游的 craft-ai-mcp 网关；出现即写入 [mcp_servers.ArtCraft]"
                  : status.gatewayReady
                    ? (status.mcpRegistered
                      ? "已写入 [mcp_servers.ArtCraft]；重启应用后引擎加载（4 个工具：列 App / 找工具 / describe / call）"
                      : "已检测到网关，配置还没写入 —— 点右侧「写入配置」")
                    : "当前 Launcher 版本还没随包提供网关（上游代码只在 main 分支）。Launcher 新版发布后点「重新检测」；路径预期 %LOCALAPPDATA%\\ArtCraft\\mcp\\bin\\craft-ai-mcp.exe"}
              </small>
            </span>
            <div className="runtime-actions">
              <span className={`runtime-badge ${status?.gatewayReady ? "installed" : ""}`}>{gatewayBadge}</span>
              {status?.gatewayReady ? (
                <>
                  {!status.mcpRegistered && (
                    <button type="button" className="secondary-setting runtime-install" disabled={syncing} onClick={() => void syncGateway()}>
                      {syncing ? <><Spinner /> 写入中</> : <><Plug size={13} />写入配置</>}
                    </button>
                  )}
                  <button type="button" className="secondary-setting runtime-install" onClick={() => void copySnippet()}>
                    <Copy size={13} />复制配置
                  </button>
                </>
              ) : status?.installed ? (
                <button type="button" className="secondary-setting runtime-install" disabled={syncing} onClick={() => void syncGateway()}>
                  {syncing ? <><Spinner /> 检测中</> : <><RefreshCw size={13} />重新检测</>}
                </button>
              ) : null}
            </div>
          </div>

          <div className={`runtime-row ${status?.installed ? "installed" : "missing"}`}>
            <span className="runtime-icon"><Palette size={15} /></span>
            <span className="runtime-copy">
              <strong>打开 Launcher</strong>
              <small>{status?.installed ? "安装 / 更新 / 打开任意创作 App 都在 Launcher 里完成（应用由它自己下载安装）" : "装好 Launcher 后可以在这里直接打开"}</small>
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
            <small>点任意一个看用途与来源；PhotoCraft 已单独接入 Codex，其余等 Launcher 网关就绪后统一驱动</small>
          </div>
          <div className="craft-app-grid">
            {CRAFT_APPS.map((item) => (
              <button type="button" className="craft-app-tile" key={item.key} onClick={() => setSelectedApp(item.key)} aria-label={`查看 ${item.name}`}>
                <span className="craft-app-badge">{appBadge(item.name)}</span>
                <span className="craft-app-copy">
                  <strong>{item.name}</strong>
                  <small>{item.zh}</small>
                </span>
                {item.integrated ? <span className="craft-app-tag">已接入</span> : null}
              </button>
            ))}
          </div>

          <ul className="feishu-cli-notes">
            <li>上游项目标记 early alpha：安装与应用版本由 Launcher 自己管理，本卡只负责装 / 更 / 打开 Launcher。</li>
            <li>⛔ 本应用只下载官方 GitHub release 的便携包（镜像序 + SHA256SUMS 校验），不重打包、不搬源码、不冒充 ArtCraft 官方。</li>
            <li>网关（craft-ai-mcp）与「AI 可用哪些 App」的同意表都还在上游未发布分支；一旦随包出货，本卡检测到就自动写入配置。</li>
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
          size={app.integrated ? "md" : "md-auto"}
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
            <div className="settings-section stack">
              <p className="craft-detail-desc">{app.desc}</p>
              <div className="runtime-row installed">
                <span className="runtime-icon"><Download size={15} /></span>
                <span className="runtime-copy">
                  <strong>安装与打开</strong>
                  <small>
                    {status?.installed ? "" : "先关掉这层、在全家桶首页装好 ArtCraft Launcher；"}
                    {app.sizeMb ? `Windows x64 便携包约 ${app.sizeMb} MB · ` : "体积随版本 · "}
                    应用由 Launcher 下载安装（它自己处理安装目录与 UAC），这里只负责把 Launcher 打开。
                  </small>
                </span>
                <div className="runtime-actions">
                  <button type="button" className="secondary-setting runtime-install" disabled={opening || !status?.installed} onClick={() => void openLauncher()}>
                    {opening ? <><Spinner /> 打开中</> : "在 Launcher 中安装"}
                  </button>
                </div>
              </div>
              <div className="runtime-row installed">
                <span className="runtime-icon"><ExternalLink size={15} /></span>
                <span className="runtime-copy">
                  <strong>来源</strong>
                  <small>{app.repo}</small>
                </span>
                <div className="runtime-actions">
                  <button type="button" className="secondary-setting runtime-install" onClick={() => void window.codex.openExternal(app.repo)}>GitHub</button>
                  {app.site ? <button type="button" className="secondary-setting runtime-install" onClick={() => void window.codex.openExternal(app.site as string)}>官网</button> : null}
                </div>
              </div>
              <p className="settings-hint">
                上游把每个动作都暴露成引擎命令（CLI / JSON-lines 控制通道 / MCP server）。等 Launcher 新版随包提供 craft-ai-mcp 网关后，
                Codex 会通过一条 [mcp_servers.ArtCraft] 驱动全部已装 App —— 全家桶首页会自动检测并写入。
              </p>
            </div>
          )}
        </SettingsDialog>
      )}
    </>
  );
}
