import { useCallback, useEffect, useState } from "react";
import { Download, ExternalLink, Globe2, RefreshCw } from "lucide-react";

type EgoStatus = Awaited<ReturnType<typeof window.codex.egoStatus>>;

/** 开发工具 → Ego Lite：浏览器自动化**首选**通道（外部安装；未装回落 browse-skills 默认浏览器）。
 *  ⛔ 不把 611MB 的 Chromium 随应用内置（用户拍板）：这里只做检测、官方下载页与打开；
 *  **升级/自动更新统一在「设置 → 控制台 → 组件更新」的 Ego Lite 行**（10-22 用户要求）。
 *  每个 Codex 会话的 Space 由浏览器技能用 CODEX_THREAD_ID 固定；本卡不绑会话。 */
export function EgoLiteCard({ onNotice }: { onNotice?: (message: string) => void }) {
  const [status, setStatus] = useState<EgoStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState("");

  const recheck = useCallback(async (announce = false) => {
    setChecking(true);
    try {
      const next = await window.codex.egoStatus();
      setStatus(next);
      if (announce) {
        const message = next.installed
          ? `已重新检测：已安装 ${String(next.version || "ego lite").replace(/^ego-browser\s*/i, "") || "ego lite"}`
          : "已重新检测：仍未找到 ego-browser，请确认安装完成并走完首次引导";
        setNote(message);
        onNotice?.(message);
      }
    } catch (error: any) {
      setStatus(null);
      if (announce) {
        const message = `重新检测失败：${error?.message ?? error}`;
        setNote(message);
        onNotice?.(message);
      }
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void recheck();
    // 安装器/引导完成后切回应用：自动重新检测，用户不用猜什么时候点刷新
    const onFocus = () => { void recheck(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [recheck]);

  async function install() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.codex.egoInstall();
      setNote(result.detail);
      onNotice?.(result.detail);
    } catch (error: any) {
      setNote(`打开下载页失败：${error?.message ?? error}`);
    } finally { setBusy(false); }
  }

  async function open() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.codex.egoOpen();
      setNote(result.detail);
      await recheck();
    } catch (error: any) {
      setNote(`打开 ego lite 失败：${error?.message ?? error}`);
    } finally { setBusy(false); }
  }

  const installed = Boolean(status?.installed);
  const version = String(status?.version ?? "").replace(/^ego-browser\s*/i, "");

  return (
    <div className="ego-lite-card">
      <div className="ego-lite-head">
        <span className="ego-lite-logo"><Globe2 size={17} /></span>
        <div className="ego-lite-copy">
          <div className="ego-lite-title">
            <strong>Ego Lite 浏览器自动化</strong>
            <span className={`ego-lite-badge ${installed ? "ok" : "missing"}`}>
              {installed ? `已安装${version ? ` · ${version}` : ""}` : "未安装"}
            </span>
          </div>
          <small>浏览器自动化首选通道：每个 Codex 会话一个独立 Space，多会话可同时跑；共享你当前的登录态。未安装时回落 browse-skills（nuphus 默认浏览器）。</small>
        </div>
      </div>

      {installed && status?.cliPath ? <div className="ego-lite-meta">CLI：{status.cliPath}</div> : null}

      <div className="ego-lite-actions">
        {installed ? (
          <>
            <button type="button" className="primary-setting" disabled={busy} onClick={() => void open()}>
              <ExternalLink size={13} />打开 ego lite
            </button>
            <button type="button" className="secondary-setting" disabled={busy || checking} onClick={() => void recheck(true)}>
              <RefreshCw size={13} className={checking ? "spin" : ""} />{checking ? "检测中…" : "重新检测"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="primary-setting" disabled={busy} onClick={() => void install()}>
              <Download size={13} />下载安装
            </button>
            <button type="button" className="secondary-setting" disabled={busy || checking} onClick={() => void recheck(true)}>
              <RefreshCw size={13} className={checking ? "spin" : ""} />{checking ? "检测中…" : "重新检测"}
            </button>
          </>
        )}
      </div>

      <p className="ego-lite-hint">
        {installed
          ? "技能按 CODEX_THREAD_ID 续用同一个 codex-<会话ID> Space；会话归档时自动回收，多个会话互不抢页面。升级与自动更新在「设置 → 控制台 → 组件更新」的 Ego Lite 行：由 Ego 官方更新器下载（可能约 600MB 并重启浏览器，暂无第三方国内镜像）。"
          : "不随应用内置：Windows 安装包约 13.5MB、macOS 146–164MB，首次启动会下载约 600MB Chromium。装完完成首次引导，CLI 才可用。"}
      </p>
      {note ? <p className="ego-lite-note" aria-live="polite">{note}</p> : null}
    </div>
  );
}
