/**
 * PhotoCraft 图像编辑卡片（11-15，11-16 起挂在「开发工具 → Craft 全家桶 → PhotoCraft」三层弹窗的第三层，结构照 ApkStartCard / FileeCard）。
 *
 * 两步：装 PhotoCraft（GitHub release 便携包约 137MB，镜像序 + SHA256SUMS 校验）→ Codex 用
 * photocraft 工具调色/滤镜/转换/批量；装了以后还会写 `[mcp_servers.photocraft]`（roots 限 userData/photocraft-io），
 * 图片卡上也能「在 PhotoCraft 中编辑」打开原生窗口。
 * ⛔ 卸载只删程序目录（tools/photocraft）与 MCP 段；用户自己的图片一概不动。
 * ⛔ 状态以主进程 photocraft:status 为准（版本文件 + CLI 存在）。
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Brush, Check, Download, ExternalLink, FolderOpen, Plug, RefreshCw, Trash2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { SettingsDialog } from "../../components/SettingsDialog";
import { RuntimeUpdateRow } from "./RuntimeUpdateRow";

const CAPABILITIES = [
  { icon: Brush, title: "专业后期", desc: "曲线 / 色阶 / 自然饱和度 / 锐化 / 蒙版 / 文字图层，生成图也能精修" },
  { icon: Check, title: "格式与 PSD", desc: "PNG / JPEG / WebP / TIFF / PSD / PSB 互转，可交付分层文件" },
  { icon: Download, title: "批量处理", desc: "对整目录套同一组命令（调色 + 锐化 + 转格式），适合电商与素材整理" },
  { icon: Plug, title: "命令可发现", desc: "500+ 引擎命令：Codex 先查命令 id、再按参数执行，不是固定几条预设" },
];

const EXAMPLES = [
  "把这张图调成更有电影感的冷色调，另存一份别覆盖原图",
  "整批把 raw/ 里的图锐化 + 转 webp 放到 web/",
  "把这张图转成 PSD，我要自己再改图层",
  "在 PhotoCraft 里打开这张生成图，我想手工修一下",
];

type Status = {
  installed: boolean;
  version: string;
  cliPath: string;
  guiPath: string;
  ioRoot: string;
  mcpRegistered: boolean;
  platform: string;
  sizeBytes: number;
  attribution: { license: string; home: string };
};

/** 从 exe 路径推安装目录（Windows / mac 分隔符都认）。 */
function dirOf(file?: string): string {
  const value = String(file ?? "");
  const cut = Math.max(value.lastIndexOf("\\"), value.lastIndexOf("/"));
  return cut > 0 ? value.slice(0, cut) : "";
}

/** PhotoCraft 卡片：安装 / 版本 / MCP 段 / GUI 打开 / 卸载。 */
export function PhotoCraftCard({ setNotice, installDevRuntime, runtimeInstalling, uninstallDevRuntime, runtimeUninstalling, runtimeStage, runtimePercent, runtimeSpeed, runtimeProgress, cancelDevRuntime, setRuntimeModal, installDir, customRoot, onPickRoot }: {
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
  /** 安装位置与「修改位置」：与其它 App 弹窗同一套行（PhotoCraft 自己的安装目录由状态里的 GUI/CLI 路径推出）。 */
  installDir?: string;
  customRoot?: string;
  onPickRoot?: (clear?: boolean) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const photoCraftDir = installDir || dirOf(status?.guiPath) || dirOf(status?.cliPath);

  const refresh = useCallback(async () => {
    try { setStatus((await window.codex.photocraftStatus()) as Status); } catch { /* 主进程没接上就保持现状 */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const off = window.codex.onRuntimeProgress((payload: { id?: string; done?: boolean }) => {
      if (payload?.id !== "photocraft" || !payload.done) return;
      void refresh();
    });
    return off;
  }, [refresh]);

  const installing = runtimeInstalling === "photocraft";
  const uninstalling = runtimeUninstalling === "photocraft";
  const percent = Math.round(Number(runtimePercent?.["photocraft"] ?? 0));
  const stage = runtimeStage?.["photocraft"] ?? "";
  const speed = runtimeSpeed?.["photocraft"] ?? "";
  const latest = runtimeProgress?.["photocraft"] ?? "";
  const installFailed = !installing && !uninstalling && /失败/.test(latest);
  const sizeMb = Math.round(Number(status?.sizeBytes ?? 0) / 1048576);

  const openGui = async () => {
    setOpening(true);
    try {
      const result = await window.codex.photocraftOpen({});
      if (!result?.ok) setNotice("打开 PhotoCraft 失败", result?.error);
    } catch (error) {
      setNotice("打开 PhotoCraft 失败", String((error as Error)?.message ?? error));
    } finally {
      setOpening(false);
    }
  };

  const uninstall = async () => {
    setUninstallOpen(false);
    try {
      await Promise.resolve(uninstallDevRuntime?.("photocraft"));
      setNotice("正在卸载 PhotoCraft", "删完这张卡会自动变回「未安装」；你的图片文件不受影响");
    } catch (error) {
      setNotice("卸载失败", String((error as Error)?.message ?? error));
    }
  };

  return (
    <>
      <section className="settings-section stack feishu-cli-card">
        <div className="feishu-cli-list">
          <div className={`runtime-row ${status?.installed ? "installed" : "missing"} ${installing || uninstalling ? "busy" : ""}`}>
            <span className="runtime-icon">{installing || uninstalling ? <Spinner /> : status?.installed ? <Check size={15} /> : <Download size={15} />}</span>
            <span className="runtime-copy">
              <strong>安装 PhotoCraft</strong>
              <small>
                {uninstalling
                  ? "正在卸载（删除程序目录并移除 MCP 段；图片文件不受影响）…"
                  : installing
                    ? "正在下载（约 137 MB，自动选最快的国内镜像并校验 SHA256）…"
                    : status?.installed
                      ? `已安装${status.version ? ` ${status.version}` : ""}${sizeMb ? ` · ${sizeMb} MB` : ""}；卸载只删程序，不动你的图片`
                      : "约 137 MB：纯 Rust 的 Photoshop 重写（MIT/Apache-2.0），Windows 含 CLI+GUI；mac 只随 CLI"}
              </small>
              {installing || uninstalling ? (
                <span className="runtime-install-state devtools-progress-row">
                  <span className="runtime-progress-bar" role="progressbar" aria-label="PhotoCraft 安装进度" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                    <i style={{ width: `${percent}%` }} />
                  </span>
                  <em className="runtime-progress">
                    {stage || (uninstalling ? "正在删除程序目录…" : "正在选择最快的下载源…")}
                    {percent ? ` · ${percent}%` : ""}
                    {!uninstalling && speed ? ` · ${speed}` : ""}
                    {latest && !installFailed ? ` · ${latest}` : ""}
                  </em>
                </span>
              ) : null}
              {installFailed ? (
                <button type="button" className="runtime-failed" onClick={() => setRuntimeModal?.({ id: "photocraft", name: "PhotoCraft 图像编辑", mode: "install", done: true, failed: true, error: latest.replace(/^安装失败：/, "") })}>
                  <AlertTriangle size={12} />安装失败 · 点开完整报错与备用方案
                </button>
              ) : null}
            </span>
            <div className="runtime-actions">
              {status?.installed ? (
                <>
                  <span className="runtime-badge installed">已安装</span>
                  <button type="button" className="runtime-install feishu-cli-uninstall" disabled={uninstalling} title="卸载 PhotoCraft（弹窗确认）" onClick={() => setUninstallOpen(true)}>
                    {uninstalling ? <><Spinner /> 卸载中</> : <><Trash2 size={13} />卸载</>}
                  </button>
                </>
              ) : uninstalling ? (
                <span className="runtime-badge"><Spinner /> 卸载中</span>
              ) : installing ? (
                <button type="button" className="secondary-setting runtime-cancel" onClick={() => void cancelDevRuntime?.("photocraft")}>取消</button>
              ) : (
                <button type="button" className="primary-setting runtime-install" disabled={Boolean(runtimeInstalling)} onClick={() => installDevRuntime?.("photocraft")}>
                  <Download size={14} />安装
                </button>
              )}
            </div>
          </div>

          <div className={`runtime-row ${photoCraftDir ? "installed" : "missing"}`}>
            <span className="runtime-icon"><FolderOpen size={15} /></span>
            <span className="runtime-copy">
              <strong>安装位置</strong>
              <small title={photoCraftDir || undefined}>
                {photoCraftDir
                  ? `${photoCraftDir}（${customRoot ? "手动指定" : "自动检测"}）`
                  : `还没找到 PhotoCraft —— ${customRoot ? `当前手动指定：${customRoot}` : "已按常见目录自动扫描"}；装在别的盘时点右侧指定`}
              </small>
            </span>
            <div className="runtime-actions">
              <button type="button" className="secondary-setting runtime-install" title="选择包含各 App 文件夹的那一级目录" onClick={() => onPickRoot?.()}>
                修改位置
              </button>
              {customRoot ? (
                <button type="button" className="secondary-setting runtime-install" onClick={() => onPickRoot?.(true)}>自动检测</button>
              ) : null}
            </div>
          </div>

          <RuntimeUpdateRow
            id="photocraft"
            installed={Boolean(status?.installed)}
            hint="从 GitHub release 镜像序拉新版并 SHA256SUMS 校验；只换程序，图片与配置不受影响"
            runtimeStage={runtimeStage}
            runtimePercent={runtimePercent}
            runtimeSpeed={runtimeSpeed}
            runtimeProgress={runtimeProgress}
            cancelDevRuntime={cancelDevRuntime}
            onUpdated={refresh}
          />

          <div className={`runtime-row ${status?.installed ? "installed" : "missing"}`}>
            <span className="runtime-icon"><Plug size={15} /></span>
            <span className="runtime-copy">
              <strong>MCP 连接器</strong>
              <small>
                {status?.mcpRegistered
                  ? `已写入 [mcp_servers.photocraft]（headless CLI；收发目录 ${status.ioRoot}）—— 引擎重启后可用`
                  : "安装后自动写入 config.toml；引擎可能延迟暴露 MCP 工具，Codex 主路径仍是 photocraft 工具"}
              </small>
            </span>
            <div className="runtime-actions">
              <span className={`runtime-badge ${status?.mcpRegistered ? "installed" : ""}`}>{status?.mcpRegistered ? "已注册" : status?.installed ? "重启引擎后注册" : "安装后可用"}</span>
            </div>
          </div>

          <div className={`runtime-row ${status?.installed ? "installed" : "missing"}`}>
            <span className="runtime-icon"><Brush size={15} /></span>
            <span className="runtime-copy">
              <strong>原生窗口编辑</strong>
              <small>{status?.guiPath ? "打开 PhotoCraft 原生窗口手工精修；图片产物卡片上也有「在 PhotoCraft 中编辑」" : "本平台只随 CLI：mac 请从 getartcraft.com 安装 PhotoCraft App 后用图片卡打开"}</small>
            </span>
            <div className="runtime-actions">
              {status?.installed && status?.guiPath ? (
                <button type="button" className="secondary-setting runtime-install" disabled={opening} onClick={() => void openGui()}>
                  {opening ? <><Spinner /> 打开中</> : "打开 PhotoCraft"}
                </button>
              ) : (
                <span className="runtime-badge">{status?.installed ? "仅 CLI" : "安装后可用"}</span>
              )}
            </div>
          </div>
        </div>

        <section className="feishu-cli-guide">
          <div className="feishu-cli-guide-head">
            <strong>能做什么</strong>
            <small>开源 Photoshop 重写：图层 / 蒙版 / 调整层 / 文字 / PSD 都在；Codex 通过命令驱动同一套引擎</small>
          </div>
          <div className="feishu-cli-cap-grid">
            {CAPABILITIES.map(({ icon: Icon, title, desc }) => (
              <div className="feishu-cli-cap" key={title}>
                <span className="feishu-cli-cap-icon"><Icon size={15} /></span>
                <span className="feishu-cli-cap-copy"><strong>{title}</strong><small>{desc}</small></span>
              </div>
            ))}
          </div>

          <div className="feishu-cli-guide-head">
            <strong>怎么用</strong>
            <small>装好后直接在对话里说人话；Codex 会先查命令、再处理并另存新文件（不覆盖原图）</small>
          </div>
          <ol className="feishu-cli-guide-steps">
            <li><b>给文件与目标</b><span>例如「把 D:\shots\a.png 调成冷色调，存到 D:\shots\a-graded.png」。</span></li>
            <li><b>说清要什么效果</b><span>「曲线提亮暗部」「自然饱和度 +30」「锐化 60」——Codex 会用 commands 查 id 后执行。</span></li>
            <li><b>批量就说明目录</b><span>「raw/ 全部转 webp 到 web/」，同一组命令会套到每个文件。</span></li>
          </ol>

          <div className="feishu-cli-examples">
            {EXAMPLES.map((text) => <span className="feishu-cli-example" key={text}>{text}</span>)}
          </div>

          <ul className="feishu-cli-notes">
            <li>项目处于 early alpha：命令 id 与参数会随版本变化，装的是固定版本，升级走本卡「更新」行。</li>
            <li>输出文件不能与输入同路径（避免覆盖原图）；所有读写必须在会话工作目录或应用数据目录内。</li>
            <li>MCP 连接器只授予 userData/photocraft-io 的读写根；项目文件请让 Codex 走 photocraft 工具处理。</li>
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
              <button type="button" className="secondary-setting runtime-install" onClick={() => void window.codex.openExternal(status.attribution.home)}>打开项目主页</button>
            </div>
          </div>
        )}
      </section>

      {uninstallOpen && (
        <SettingsDialog title="卸载 PhotoCraft？" icon={<Trash2 size={15} />} hint="只删程序目录与 MCP 段；你的图片与项目文件不受影响" size="sm" onClose={() => setUninstallOpen(false)}>
          <div className="settings-section stack">
            <p className="settings-hint">卸载后 Codex 的 photocraft 工具会变成「未安装」提示；重新安装即可恢复。确认卸载？</p>
            <div className="settings-actions">
              <button type="button" className="secondary-setting" onClick={() => setUninstallOpen(false)}>取消</button>
              <button type="button" className="primary-setting danger" onClick={() => void uninstall()}>卸载</button>
            </div>
          </div>
        </SettingsDialog>
      )}
    </>
  );
}
