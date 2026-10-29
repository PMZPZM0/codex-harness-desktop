/**
 * 飞书 CLI 卡片（10-29，嵌在「设置 → 开发工具」）。
 *
 * 三步：装 CLI → 配置飞书应用（config init）→ 用户登录（device flow）。
 * ⛔ 登录必须是官方 device flow：`auth login --no-wait` 拿链接 → 用户在浏览器确认 →
 *    后台 `--device-code` 落地。这里只显示链接与状态，不自己编凭据。
 * ⛔ 状态以主进程 feishu-cli:status 为准（它真跑 `lark-cli auth status --json`）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, Check, Copy, ExternalLink, LogOut, Download } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { copyTextToClipboard } from "../../lib/clipboard";

type Status = {
  installed: boolean;
  path: string;
  version: string;
  configured: boolean;
  loggedIn: boolean;
  user: string;
  detail: string;
  error: string;
};

export function FeishuCliCard({ setNotice, installDevRuntime, runtimeInstalling }: {
  setNotice: (text: string) => void;
  installDevRuntime?: (id: string) => void;
  runtimeInstalling?: Record<string, boolean> | null;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"" | "setup" | "login" | "logout">("");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const releaseRef = useRef<number>(0);

  const refresh = useCallback(async () => {
    try {
      const next = (await window.codex.feishuCliStatus()) as Status;
      setStatus(next);
      /* ⛔ 配置/登录一完成，授权链接就被消费掉了 ⇒ 收起链接、放掉「等待中」。
         只在 link 挂着时轮询，所以这里不放 busy 的话：用户中途放弃浏览器，
         按钮会永远停在「等待浏览器…」且 disabled —— 再也点不回来。 */
      if (next.configured || next.loggedIn) setLink("");
      if (next.loggedIn) setBusy("");
      else if (next.configured) setBusy((prev) => (prev === "setup" ? "" : prev));
      return next;
    } catch (err: any) {
      setError(String(err?.message ?? err));
      return null;
    }
  }, []);

  /* 兜底：浏览器那一步可能被用户放弃（或用户在另一台设备完成）。10 分钟后自动解除「等待中」，
     让按钮可以再点一次；状态仍以主进程为准。 */
  const scheduleRelease = () => {
    if (releaseRef.current) window.clearTimeout(releaseRef.current);
    releaseRef.current = window.setTimeout(() => setBusy(""), 10 * 60_000);
  };

  useEffect(() => { void refresh(); }, [refresh]);

  // 拿到授权链接后每 2 秒看一次状态（登录/配置完成后自动收起链接）
  useEffect(() => {
    if (!link) return;
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => window.clearInterval(timer);
  }, [link, refresh]);

  useEffect(() => () => { if (releaseRef.current) window.clearTimeout(releaseRef.current); }, []);

  const installing = Boolean(runtimeInstalling?.["feishu-cli"]);

  const startSetup = async () => {
    setError(""); setBusy("setup"); scheduleRelease();
    try {
      const result: any = await window.codex.feishuCliSetupStart();
      if (result?.ok && result.url) { setLink(result.url); setNotice?.("已生成飞书应用配置链接：在浏览器里完成即可"); }
      else { setError(String(result?.error ?? "没有拿到授权链接")); setBusy(""); }
    } catch (err: any) { setError(String(err?.message ?? err)); setBusy(""); }
  };

  const startLogin = async () => {
    setError(""); setBusy("login"); scheduleRelease();
    try {
      const result: any = await window.codex.feishuCliLoginStart();
      if (result?.ok && result.url) { setLink(result.url); setNotice?.("已生成登录链接：浏览器确认后会自动完成"); }
      else { setError(String(result?.error ?? "没有拿到登录链接")); setBusy(""); }
    } catch (err: any) { setError(String(err?.message ?? err)); setBusy(""); }
  };

  const logout = async () => {
    setError(""); setBusy("logout");
    try { await window.codex.feishuCliLogout(); } catch (err: any) { setError(String(err?.message ?? err)); }
    setBusy(""); void refresh();
  };

  const copy = () => { if (link) void copyTextToClipboard(link).then(() => setNotice?.("链接已复制")).catch(() => undefined); };

  return (
    <section className="settings-section stack feishu-cli-card">
      <div className="settings-card-head">
        <span className="settings-card-icon"><Bot size={16} /></span>
        <div>
          <strong>飞书 CLI（官方）</strong>
          <small>装完后 Codex 可以用 feishu_cli 工具代你操作飞书（消息 / 文档 / 表格 / 日历 / 任务）</small>
        </div>
      </div>

      <div className="feishu-cli-steps">
        <div className={`feishu-cli-step ${status?.installed ? "done" : ""}`}>
          <span>1</span>
          <div><strong>安装 CLI</strong><small>{status?.installed ? `已安装 ${status.version || ""}` : "约 51 MB，走国内 npm 镜像"}</small></div>
          {status?.installed ? <Check size={15} /> : (
            <button type="button" className="primary-setting" disabled={installing} onClick={() => installDevRuntime?.("feishu-cli")}>
              {installing ? <><Spinner /> 安装中…</> : <><Download size={13} /> 安装</>}
            </button>
          )}
        </div>

        <div className={`feishu-cli-step ${status?.configured ? "done" : ""}`}>
          <span>2</span>
          <div><strong>配置飞书应用</strong><small>{status?.configured ? "已配置" : "在浏览器里创建/绑定一个飞书应用（一次即可）"}</small></div>
          {status?.configured ? <Check size={15} /> : (
            <button type="button" className="secondary-setting" disabled={!status?.installed || Boolean(busy)} onClick={() => void startSetup()}>
              {busy === "setup" ? <><Spinner /> 等待浏览器…</> : <><ExternalLink size={13} /> 去配置</>}
            </button>
          )}
        </div>

        <div className={`feishu-cli-step ${status?.loggedIn ? "done" : ""}`}>
          <span>3</span>
          <div><strong>登录飞书</strong><small>{status?.loggedIn ? `已登录${status.user ? `：${status.user}` : ""}` : "扫码/浏览器授权一次，之后自动复用"}</small></div>
          {status?.loggedIn ? (
            <button type="button" className="secondary-setting" disabled={busy === "logout"} onClick={() => void logout()}>
              {busy === "logout" ? <Spinner /> : <><LogOut size={13} /> 退出登录</>}
            </button>
          ) : (
            <button type="button" className="primary-setting" disabled={!status?.configured || Boolean(busy)} onClick={() => void startLogin()}>
              {busy === "login" ? <><Spinner /> 等待授权…</> : <><ExternalLink size={13} /> 登录</>}
            </button>
          )}
        </div>
      </div>

      {link ? (
        <div className="feishu-cli-link">
          <a href={link} target="_blank" rel="noopener noreferrer">{link}</a>
          <button type="button" className="secondary-setting" onClick={copy}><Copy size={13} /> 复制链接</button>
        </div>
      ) : null}

      {status?.installed && !status.configured && status.error ? (
        <p className="settings-card-hint"><AlertTriangle size={13} /> 还没配置飞书应用：点第 2 步「去配置」，在浏览器完成即可。</p>
      ) : null}
      {error ? <p className="settings-card-hint" style={{ color: "var(--danger, #c0392b)" }}><AlertTriangle size={13} /> {error}</p> : null}
    </section>
  );
}
