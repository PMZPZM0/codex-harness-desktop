/**
 * OpenaiSubscriptionPage 的「official-cards」部分（09-22 从同目录 OpenaiSubscriptionPage.tsx 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { CircleGauge, Clock3, AlertTriangle, Bot, Check, Play, LogIn, Trash2, Plus, FileUp, X, RefreshCw } from "lucide-react";
import { OFFICIAL_MODELS } from "../../../lib/official-models";
import { Spinner } from "../../../components/CardShell";
import { useState, useRef, useCallback, useEffect } from "react";
import { parseOpenaiUsagePanel, openaiResetText } from "./01-usage-parsers";
export function OpenaiBalanceBadge({ accountKey }: { accountKey?: string | null }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<ReturnType<typeof parseOpenaiUsagePanel> | null>(null);
  const [err, setErr] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async () => {
    try {
      setPanel(parseOpenaiUsagePanel(await window.codex.openaiUsage()));
      setErr("");
    } catch (e: any) { setErr(e.message ?? "额度同步失败"); }
  }, []);
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (!accountKey) return;
    void refresh();
    const timer = window.setInterval(refresh, 60_000); // 与中转站余额徽标同节奏的实时同步
    const tick = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => { window.clearInterval(timer); window.clearInterval(tick); };
  }, [accountKey, refresh]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  if (!accountKey) return null;
  const primary = panel?.windows[0];
  const summary = err ? "额度同步失败" : panel && primary ? `订阅已用 ${Math.round(primary.usedPercent)}%` : "订阅";
  return <div className="relay-badge" ref={wrapRef}>
    <button type="button" className="context-ring relay-badge-btn" title="OpenAI 订阅额度" aria-label="OpenAI 订阅额度" onClick={() => { setOpen((v) => !v); if (!panel) void refresh(); }}>
      <CircleGauge size={13} /><small>{summary}</small>
    </button>
    {open && <div className="ctx-pop relay-pop" role="dialog" aria-label="OpenAI 订阅额度明细" onMouseLeave={() => setOpen(false)}>
      <div className="ctx-pop-head"><strong>OpenAI 官方订阅</strong>{panel?.planType && <span className="openai-plan-badge">{panel.planType}</span>}</div>
      <div className="ctx-pop-sub">{err ? err : "额度每 5 分钟与官方同步"}</div>
      {panel && panel.windows.length > 0 && (
        <div className="ctx-pop-grid">
          {panel.windows.map((win) => (
            <div className="ctx-pop-cell" key={win.label}>
              <span className="ctx-pop-cell-label">{win.label}</span>
              <div className="relay-plan-progress"><i style={{ width: win.usedPercent + "%" }} /></div>
              <b className="ctx-pop-cell-value">已用 {Math.round(win.usedPercent)}%</b>
              {win.resetAt ? <small className="openai-reset-line"><Clock3 size={10} />{openaiResetText(win.resetAt, nowTick)}</small> : null}
            </div>
          ))}
        </div>
      )}
      {panel?.limitReached && <p className="relay-account-err"><AlertTriangle size={13} />当前窗口额度已用尽，等待窗口重置或切换中转站。</p>}
      {!err && panel && panel.windows.length === 0 && <p className="openai-sub-line">官方未返回窗口用量数据（可能尚未产生用量）。</p>}
      <p className="ctx-pop-cache-note">设置 → 账户 → OpenAI 订阅 可管理账号与切换。</p>
    </div>}
  </div>;
}

function OpenaiOfficialCard({ activeProvider, onActivate, onNotice }: { activeProvider?: string; onActivate: (models: string[]) => Promise<void> | void; onNotice: (m: string) => void }) {
  const [status, setStatus] = useState<{ loggedIn: boolean; email: string } | null>(null);
  const [device, setDevice] = useState<{ url: string; code: string; raw?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<string>("");
  const [usageOpen, setUsageOpen] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [proxy, setProxy] = useState(() => localStorage.getItem("openai-proxy") ?? "");
  const timerRef = useRef<number | null>(null);
  const isActive = activeProvider === "openai-official";
  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current); }, []);
  const loadUsage = async () => {
    try { setUsage(JSON.stringify(await window.codex.openaiUsage(), null, 1).slice(0, 800)); } catch (e: any) { setUsage("额度查询失败：" + (e.message ?? e)); }
  };
  const startLogin = async () => {
    setBusy(true); setLoginError("");
    try {
      const proxyValue = proxy.trim();
      if (proxyValue) localStorage.setItem("openai-proxy", proxyValue); else localStorage.removeItem("openai-proxy");
      void window.codex.openaiSetProxy(proxyValue).catch(() => undefined);
      await window.codex.openaiLoginStart({ proxy: proxyValue || undefined });
      let opened = false;
      const openAuth = (url: string) => {
        if (opened || !url) return;
        opened = true;
        void window.codex.openExternal(url).catch((e: any) => onNotice("打开浏览器失败：" + (e.message ?? e) + "，请手动访问 " + url));
      };
      const first = await window.codex.openaiLoginStatus();
      setDevice({ url: first.url, code: first.code, raw: first.lines });
      if (first.error) setLoginError(first.error);
      openAuth(first.url);
      const startedAt = Date.now();
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(async () => {
        const s = await window.codex.openaiLoginStatus();
        setDevice({ url: s.url, code: s.code, raw: s.lines });
        openAuth(s.url);
        if (s.error && !s.childAlive && !s.loggedIn) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          timerRef.current = null;
          setLoginError(s.error);
          setBusy(false);
        }
        if (s.loggedIn) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          timerRef.current = null;
          setStatus({ loggedIn: true, email: s.email });
          setDevice(null); setLoginError("");
          void window.codex.openaiCaptureLogin().catch(() => undefined);
          onNotice(`OpenAI 官方账号已登录：${s.email}，正在启用订阅…`);
          await onActivate(OFFICIAL_MODELS);
        } else if (Date.now() - startedAt > 15 * 60_000) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          timerRef.current = null;
          void window.codex.openaiLoginCancel();
        }
      }, 2500);
    } catch (e: any) { onNotice("官方登录失败：" + (e.message ?? e)); } finally { setBusy(false); }
  };
  useEffect(() => { void (async () => { try { const s = await window.codex.openaiLoginStatus(); setStatus({ loggedIn: s.loggedIn, email: s.email }); if (s.loggedIn) void loadUsage(); } catch { /* IPC 不可用 */ } })(); }, []);
  return (
    <div className={`relay-entry-banner official-banner ${isActive ? "active" : ""}`}>
      <Bot size={16} />
      <div className="">
        <b>OpenAI 官方订阅（ChatGPT 登录）</b>
        <small>{status?.loggedIn ? `已登录：${status.email || "ChatGPT 账号"}` : "用 ChatGPT 账号设备码登录，直接使用 Codex 订阅额度，无需 API Key"}</small>
        {device && device.url && <small className="official-device">浏览器已打开登录页：<a href={device.url} onClick={(e) => { e.preventDefault(); void window.codex.openExternal(device.url); }}>auth.openai.com</a>，输入验证码 <b>{device.code || "见下方引擎输出"}</b></small>}
        {device && !device.code && device.raw ? <pre className="official-usage">{device.raw}</pre> : null}
        {device && !device.url && !loginError && <small className="official-device">正在向 OpenAI 申请设备验证码…</small>}
        {loginError && <small className="official-device official-error">登录失败：{loginError}。OpenAI 有区域限制——请确认代理/VPN 已开启；也可在下方填写代理地址后重试。</small>}
        {!status?.loggedIn && <small className="official-device">代理（可选）：<input className="official-proxy-input" value={proxy} onChange={(event) => setProxy(event.target.value)} placeholder="http://127.0.0.1:7890" /></small>}
      </div>
      <div className="">
        {status?.loggedIn && <button type="button" className="secondary-setting" onClick={() => { setUsageOpen((v) => !v); if (!usage) void loadUsage(); }}><CircleGauge size={13} />额度</button>}
        {status?.loggedIn
          ? <button type="button" className="secondary-setting" disabled={isActive} onClick={() => void onActivate(OFFICIAL_MODELS)}>{isActive ? <><Check size={13} />使用中</> : <><Play size={13} />启用</>}</button>
          : <button type="button" className="secondary-setting" disabled={busy} onClick={() => void startLogin()}>{busy ? <><Spinner />等待登录…</> : <><LogIn size={13} />设备码登录</>}</button>}
      </div>
      {usageOpen && usage && <pre className="official-usage">{usage}</pre>}
    </div>
  );
}
