/**
 * 开发工具 · MoeKoe Music 安装卡（10-20）。
 * 外部酷狗客户端走系统级安装，不在「运行时与工具链」里平铺；这里给唯一的手动安装/启动入口。
 * ⛔ 安装过程复用 runtime:install 的进度与并发闸（id=moekoe），界面不另造一套下载器。
 */
import { CircleCheck, ExternalLink, Music2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";

export function MoeKoeCard({
  runtime,
  installing,
  percent,
  stage,
  progress,
  onInstall,
  setNotice,
}: {
  runtime?: any;
  installing: boolean;
  percent?: number;
  stage?: string;
  progress?: string;
  onInstall: () => unknown;
  setNotice?: any;
}) {
  const installed = Boolean(runtime?.installed);
  const value = typeof percent === "number" && Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  const run = () => {
    setNotice?.("MoeKoe Music", installed ? "正在启动 MoeKoe Music…" : "正在准备安装 MoeKoe Music…");
    void Promise.resolve(onInstall()).catch((error: any) => {
      setNotice?.("MoeKoe 安装失败", String(error?.message ?? error).slice(0, 300));
    });
  };
  return (
    <div className="settings-section stack">
      <p className="settings-card-hint">
        MoeKoe Music 是外部酷狗客户端；安装后 Codex 通过它的 6521 本地 API 搜歌/播放。曲库与播放权限由 MoeKoe 客户端管理，不内置进本应用。
      </p>
      <div className={`runtime-row ${installed ? "installed" : "missing"} ${installing ? "busy" : ""}`}>
        <span className="runtime-icon">{installing ? <Spinner /> : installed ? <CircleCheck size={16} /> : <Music2 size={16} />}</span>
        <span className="runtime-copy">
          <strong>{runtime?.name ?? "MoeKoe Music（酷狗客户端）"}</strong>
          <small>{runtime?.description ?? "外部酷狗客户端：Codex 通过 6521 API 搜歌/播放"}</small>
          {installing ? (
            <span className="runtime-install-state">
              <span className="runtime-progress-bar" role="progressbar" aria-label="MoeKoe 安装进度" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${value}%` }} />
              </span>
              <em className="runtime-progress">{stage ? `${stage} · ` : ""}{value ? `${value}%` : "准备中"}{progress ? ` · ${progress}` : ""}</em>
            </span>
          ) : <em className="runtime-hint">{installed ? "已安装 · 点击启动；Codex 可直接调用 6521 API" : `系统级安装 · ${runtime?.size ?? "约 133 MB"} · 国内镜像`}</em>}
        </span>
        <span className="runtime-actions">
          <button type="button" className="primary-setting runtime-install" disabled={installing} onClick={run}>
            {installing ? <Spinner /> : <Music2 size={14} />}{installing ? "安装中…" : installed ? "启动 MoeKoe" : "安装 MoeKoe Music"}
          </button>
          <button type="button" className="secondary-setting" onClick={() => void window.codex.openExternal("https://music.moekoe.cn/")}>
            <ExternalLink size={13} />官网
          </button>
        </span>
      </div>
      <p className="settings-card-hint">安装向导可能需要 UAC；装完 Codex 会通过本地 API 调用。卸载请在 Windows「应用和功能」里操作。</p>
    </div>
  );
}
