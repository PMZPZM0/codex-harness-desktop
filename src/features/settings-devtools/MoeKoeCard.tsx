/**
 * 开发工具 · MoeKoe Music 安装卡（10-20）。
 * 外部酷狗客户端走系统级安装，不在「运行时与工具链」里平铺；这里给唯一的手动安装/启动入口。
 * ⛔ 安装过程复用 runtime:install 的进度与并发闸（id=moekoe），界面不另造一套下载器。
 */
import { BookOpen, CircleCheck, Copy, ExternalLink, Music2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { copyTextToClipboard } from "../../lib/clipboard";

/** KuGouMusicApi 文档（MoeKoe 的 6521 本地 API 就是这套）；放在卡片上方便人/Codex 后续查。 */
const API_DOCS_URL = "https://kugoumusicapi-docs.4everland.app/#/?id=kugoumusic-api";

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
  const isMac = (window.codex as any)?.platform === "darwin";
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
        <span className="runtime-actions" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" className="primary-setting runtime-install" disabled={installing} onClick={run}>
            {installing ? <Spinner /> : <Music2 size={14} />}{installing ? "安装中…" : installed ? "启动 MoeKoe" : "安装 MoeKoe Music"}
          </button>
          <button type="button" className="secondary-setting" title="打开 KuGouMusicApi 文档（6521 API）" onClick={() => void window.codex.openExternal(API_DOCS_URL)}>
            <BookOpen size={13} />API 文档
          </button>
          <button type="button" className="secondary-setting" title="复制 API 文档地址（可直接发给 Codex）" onClick={() => {
            void copyTextToClipboard(API_DOCS_URL)
              .then(() => setNotice?.("已复制 API 文档地址", API_DOCS_URL))
              .catch(() => setNotice?.("复制失败", API_DOCS_URL));
          }}>
            <Copy size={13} />
          </button>
          <button type="button" className="secondary-setting" onClick={() => void window.codex.openExternal("https://music.moekoe.cn/")}>
            <ExternalLink size={13} />官网
          </button>
        </span>
      </div>
      <p className="settings-card-hint">
        {isMac
          ? "macOS 会把 .zip 解压到 /Applications（无权限时回落 ~/Applications）；首次打开如被拦截，去「系统设置 → 隐私与安全性」允许。卸载把 MoeKoe Music.app 移到废纸篓即可。"
          : "安装向导可能需要 UAC；装完 Codex 会通过本地 API 调用。卸载请在 Windows「应用和功能」里操作。"}
      </p>
      <p className="settings-card-hint">
        声明：本应用**仅用于接口调用** —— 只通过 MoeKoe Music 的本地 KuGouMusicApi 接口进行调用，不内置其源码/资源、未收取任何费用、未对原项目进行二次创作；MoeKoe Music（GPL-2.0）与 KuGouMusicApi（MIT）版权归原作者，音乐内容版权归源站/权利人。仅用于在线试听。
      </p>
    </div>
  );
}
