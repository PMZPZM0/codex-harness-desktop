/**
 * 更新徽标与账号菜单里的更新行（11-21 重写）。
 *
 * 交互只有四步，且每一步都有明确出口：
 *   available  → 点一下 = 下载
 *   downloading→ 显示百分比（点它不做事，避免重复下载）
 *   ready      → 点一下 = 退回应用并安装（装完自动拉起新版本）
 *   failed     → 点一下 = 重新检查并下载
 *
 * ⛔ 不许在下载完成后再调用"打开安装包所在文件夹/打开安装程序"这类退化路径：
 *   `shell.openPath` 不会让应用退出，NSIS 覆盖安装必然失败 —— 那正是"装不上"的老路。
 */
import { Download, MessageSquare, RefreshCw } from "lucide-react";
import { useAppUpdate } from "./use-app-update";

/** 账户行右侧的小徽标（有更新时才出现）。 */
export function UpdateBadge() {
  const { state, download, install } = useAppUpdate();
  const phase = state.phase;
  /* ⛔ mac 没有覆盖安装这条路（主进程只把 zip 交给系统打开，由用户拖进「应用程序」）——
     徽标别写「安装」，否则点完只看到 Finder 打开、什么都没发生。 */
  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform ?? "");

  /* 平时什么都不显示：⛔ 不弹卡片、不提示、不自动下载。 */
  if (phase === "idle") return null;

  const label =
    phase === "available" ? "更新"
      : phase === "downloading" ? (state.percent ? `${Math.round(state.percent * 100)}%` : "下载中")
        : phase === "ready" ? (isMac ? "打开包" : "安装")
          : phase === "installing" ? "安装中"
            : "重试";

  const title =
    phase === "available" ? `有新版本 v${state.version ?? ""}：点击下载`
      : phase === "downloading" ? `正在下载 v${state.version ?? ""}（不影响你继续使用）`
        : phase === "ready" ? (isMac
          ? `v${state.version ?? ""} 已下载：点击打开压缩包，把应用拖进「应用程序」`
          : `v${state.version ?? ""} 已下载完成：点击安装并重启`)
          : phase === "installing" ? "正在安装并重启…"
            : state.error ?? "更新失败：点击重试";

  const onClick = () => {
    /* ⛔⛔ 11-21 用户实测「下载到一半失败后，点这个『更新』没反应」：
       旧写法 failed 时调 check()（只检查、不下载）⇒ 点了看不出任何事，得再点一次才开始下。
       failed 态点击 = **直接重新下载**（download 内部本来就会先读 latest.yml 判断版本）。 */
    if (phase === "available" || phase === "failed") void download();
    else if (phase === "ready") void install();
  };

  return (
    <button
      type="button"
      className={`account-update-badge${phase === "downloading" ? " is-downloading" : ""}${phase === "ready" ? " is-ready" : ""}`}
      title={title}
      aria-label="软件更新"
      onClick={onClick}
    >
      <Download size={13} className="account-update-icon" />
      <span className="account-update-label">{label}</span>
    </button>
  );
}

/** 账号菜单里的更新行（版本信息 + 一个主按钮）。 */
export function UpdateMenuRow() {
  const { state, busy, checking, lastCheck, check, download, install } = useAppUpdate();
  const phase = state.phase;
  const sizeText = state.size ? `${(state.size / 1048576).toFixed(1)} MB` : "";

  /* 11-21 用户令「检查更新要加反馈」：点完必须能看到结论 ——
     已是最新时 phase 仍是 idle，旧实现界面毫无变化，用户以为点了没反应。 */
  const checkFeedback = checking
    ? "正在检查最新版本…"
    : lastCheck
      ? !lastCheck.ok
        ? `检查失败：${lastCheck.error ?? "网络或镜像不可用"}`
        : lastCheck.version
          ? `发现新版本 v${lastCheck.version}`
          : `已是最新（v${lastCheck.current || state.currentVersion || "—"}）`
      : "";

  const openFeedback = () => {
    /* 打开本仓 Issues 新建页（URL 由主进程按本仓仓库拼，⛔ 渲染层不写死仓库名）。 */
    void window.codex.updateFeedback?.();
  };

  const label =
    phase === "ready" ? (typeof navigator !== "undefined" && /Mac/i.test(navigator.platform ?? "") ? "打开安装包（拖进「应用程序」）" : "安装并重启")
      : phase === "downloading" ? (state.percent ? `下载中 ${Math.round(state.percent * 100)}%` : "下载中…")
        : phase === "installing" ? "正在重启安装…"
          : phase === "failed" ? "重试"
            : "立即更新";

  const run = () => {
    if (phase === "ready") void install();
    else if (phase === "available" || phase === "failed") void download();
  };

  return (
    <>
      <button className="account-menu-item" onClick={() => void check()} disabled={busy || checking}>
        <RefreshCw size={15} />
        <span>{checking ? "检查中…" : "检查更新"}</span>
        <span className="account-menu-value mono">
          {state.currentVersion ? `当前 v${state.currentVersion}` : ""}
        </span>
      </button>
      {checkFeedback ? <div className="account-menu-changelog">{checkFeedback}</div> : null}
      <button className="account-menu-item" onClick={openFeedback}>
        <MessageSquare size={15} />
        <span>意见反馈</span>
      </button>
      {phase === "available" || phase === "downloading" || phase === "ready" || phase === "installing" || phase === "failed" ? (
        <>
          <div className="account-menu-sep" />
          <div className="account-menu-section">
            {state.version ? (
              <div className="account-menu-row">
                <span className="account-menu-label">新版本</span>
                <span className="account-menu-value mono">v{state.version}</span>
              </div>
            ) : null}
            {sizeText ? (
              <div className="account-menu-row">
                <span className="account-menu-label">安装包</span>
                <span className="account-menu-value">{sizeText}{phase === "ready" ? "（已下载）" : ""}</span>
              </div>
            ) : null}
            {phase === "failed" && state.error ? (
              <div className="account-menu-changelog">{state.error}</div>
            ) : null}
          </div>
          <button className="account-menu-item primary" onClick={run} disabled={phase === "downloading" || phase === "installing"}>
            <Download size={15} />
            <span>{label}</span>
          </button>
        </>
      ) : null}
    </>
  );
}
