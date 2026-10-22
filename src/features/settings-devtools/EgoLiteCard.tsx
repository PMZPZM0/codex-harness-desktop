import { useCallback, useEffect, useState } from "react";
import { ArrowUpCircle, Download, ExternalLink, Globe2, RefreshCw } from "lucide-react";

type EgoStatus = Awaited<ReturnType<typeof window.codex.egoStatus>>;

/** 开发工具 → Ego Lite：浏览器自动化**首选**通道（外部安装；未装回落 browse-skills 默认浏览器）。
 *  ⛔ 不把 611MB 的 Chromium 随应用内置（用户拍板）：这里只做检测、官方下载页、打开与手动升级。
 *  每个 Codex 会话的 Space 由浏览器技能用 CODEX_THREAD_ID 固定；本卡不绑会话。 */
export function EgoLiteCard({ onNotice }: { onNotice?: (message: string) => void }) {
  const [status, setStatus] = useState<EgoStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmUpgrade, setConfirmUpgrade] = useState(false);
  const [note, setNote] = useState("");

  const recheck = useCallback(async () => {
    try { setStatus(await window.codex.egoStatus()); }
    catch { setStatus(null); }
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
    } catch (error: any) {
      setNote(`打开 ego lite 失败：${error?.message ?? error}`);
    } finally { setBusy(false); }
  }

  async function upgrade() {
    if (busy) return;
    setConfirmUpgrade(false);
    setBusy(true);
    setNote("正在运行 ego-browser upgrade…");
    try {
      const result = await window.codex.egoUpgrade();
      const text = result.ok
        ? (result.changed ? `已升级：${result.before || "旧版本"} → ${result.after || "新版本"}` : "已是最新版本")
        : `升级失败：${result.output || "未知原因"}`;
      setNote(text);
      onNotice?.(text);
      await recheck();
    } catch (error: any) {
      setNote(`升级失败：${error?.message ?? error}`);
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
            <button type="button" className="secondary-setting" disabled={busy} onClick={() => void recheck()}>
              <RefreshCw size={13} />重新检测
            </button>
            {confirmUpgrade ? (
              <span className="ego-lite-confirm">
                <em>升级可能下载数百 MB，继续？</em>
                <button type="button" className="primary-setting" disabled={busy} onClick={() => void upgrade()}>确认升级</button>
                <button type="button" className="secondary-setting" onClick={() => setConfirmUpgrade(false)}>取消</button>
              </span>
            ) : (
              <button type="button" className="secondary-setting" disabled={busy} onClick={() => setConfirmUpgrade(true)}>
                <ArrowUpCircle size={13} />升级
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" className="primary-setting" disabled={busy} onClick={() => void install()}>
              <Download size={13} />下载安装
            </button>
            <button type="button" className="secondary-setting" disabled={busy} onClick={() => void recheck()}>
              <RefreshCw size={13} />重新检测
            </button>
          </>
        )}
      </div>

      <p className="ego-lite-hint">
        {installed
          ? "技能按 CODEX_THREAD_ID 续用同一个 codex-<会话ID> Space；会话归档时自动回收，多个会话互不抢页面。"
          : "不随应用内置：Windows 安装包约 13.5MB、macOS 146–164MB，首次启动会下载约 600MB Chromium。装完完成首次引导，CLI 才可用。"}
      </p>
      {note ? <p className="ego-lite-note" aria-live="polite">{note}</p> : null}
    </div>
  );
}
