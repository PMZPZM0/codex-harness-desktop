/**
 * 登录域（从 src/App.tsx 原样搬来，纯搬迁零行为改动）。
 *
 * 公开面见同目录 index.ts。
 */

import { PPTokenEndpoints } from "../../lib/pptoken-endpoints";
import { Rocket, CircleGauge, Wallet, Settings2, ChevronDown, Check, KeyRound, WifiOff, ExternalLink } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { createPortal } from "react-dom";
import { performRelayLogin } from "../../lib/relay";
import { useRef, useState, useLayoutEffect, useEffect, KeyboardEvent } from "react";

export function FieldHelp({ text }: { text: string }) {
  const anchorRef = useRef<HTMLElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ anchorTop: number; anchorBottom: number; left: number; up: boolean } | null>(null);
  const TIP_W = 300;
  const open = () => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(TIP_W, window.innerWidth - 24);
    // 水平方向贴 ? 的左边缘，再夹进视口（不越界，也就不会伸到左侧列表头上）
    const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
    // 先按「向下」渲染，真正的上下翻转交给下面的布局副作用按实测高度决定
    setBox({ anchorTop: r.top, anchorBottom: r.bottom, left, up: false });
  };
  const close = () => setBox(null);
  // ⛔ 翻转必须按**实测高度**决定，不能写死阈值估算：说明文字长短差很多（「上游协议」那段实测
  //    294px），按 190 估就会向下弹、底部被视口切掉 50px，用户看不到后一半说明。
  //    useLayoutEffect 在浏览器绘制前执行，翻转过程用户看不到。
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!box || !el || box.up) return;
    const h = el.offsetHeight;
    const below = window.innerHeight - box.anchorBottom - 7 - 12;
    const above = box.anchorTop - 7 - 12;
    // 下方装得下就保持向下；装不下才向上，且上方必须比下方更宽裕（两边都紧就选大的那侧）
    if (below < h && above > below) setBox((prev) => (prev ? { ...prev, up: true } : prev));
  }, [box]);
  useEffect(() => {
    if (!box) return;
    // 滚动/改窗口后锚点会移动，而 fixed 浮层不跟随 —— 直接收起比错位好
    const dismiss = () => setBox(null);
    // 形参用 Event + 断言：本文件的 KeyboardEvent 是 React 类型（导入遮蔽了 DOM 那个），
    // 直接标它会让 addEventListener("keydown") 的重载匹配失败（同 18082 既有写法）
    const onKey = (event: Event) => {
      if (String((event as unknown as { key?: string }).key ?? "") === "Escape") setBox(null);
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [box]);
  return (
    <>
      <i
        ref={anchorRef}
        className="field-help"
        tabIndex={0}
        role="note"
        aria-label={text}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
      >?</i>
      {box && createPortal(
        <div
          ref={popRef}
          className="field-help-pop"
          role="tooltip"
          style={{
            top: box.up ? undefined : box.anchorBottom + 7,
            bottom: box.up ? window.innerHeight - box.anchorTop + 7 : undefined,
            left: box.left,
            maxWidth: Math.min(TIP_W, window.innerWidth - 24),
          }}
        >{text}</div>,
        document.body,
      )}
    </>
  );
}

export function LoginScreen({ onSkip, onLogin }: { onSkip: () => void; onLogin: (info: { provider: string; name: string; baseUrl: string; apiKey: string; model: string; username?: string }) => Promise<boolean> }) {
  const [mode, setMode] = useState<"custom" | "pptoken" | "relay" | "openai">("pptoken");
  const [username, setUsername] = useState(() => localStorage.getItem("username") || "");
  const [apiBase, setApiBase] = useState("https://api.pptoken.cc/v1");
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState(0);
  const [endpointOpen, setEndpointOpen] = useState(false);
  const endpointRef = useRef<HTMLDivElement>(null);
  const apiBaseRef = useRef<HTMLInputElement>(null);
  const apiKeyRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  // 中转站账户登录（sub2api 兼容）
  const [relayDraft, setRelayDraft] = useState({ baseUrl: "https://api.pptoken.cc", email: "", password: "" });
  // OpenAI 官方订阅登录（设备码流程）
  const [openaiDevice, setOpenaiDevice] = useState<{ url: string; code: string; raw?: string } | null>(null);
  const [openaiProxy, setOpenaiProxy] = useState(() => localStorage.getItem("openai-proxy") ?? "");
  const openaiTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (openaiTimerRef.current) window.clearInterval(openaiTimerRef.current); }, []);

  useEffect(() => {
    if (!endpointOpen) return;
    const onDown = (event: MouseEvent) => { if (!endpointRef.current?.contains(event.target as Node)) setEndpointOpen(false); };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setEndpointOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [endpointOpen]);

  const doLogin = async (provider: string, name: string, baseUrl: string, key: string) => {
    setBusy(true); setStatus("");
    try {
      const ok = await onLogin({ provider, name, baseUrl, apiKey: key, model: "", username: username.trim() || undefined });
      if (ok) return;
      setStatus("探测未返回可用模型，请检查密钥与地址");
    } catch (error: any) { setStatus("登录失败：" + error.message); }
    finally { setBusy(false); }
  };

  // 中转站账户登录：登录 → 自动选计费方式（有套餐用套餐，否则余额）→ 生成供应商进主界面
  // ⛔ 链路本体在 lib/relay.ts 的 performRelayLogin —— 引导弹窗里也有同一个入口，
  //   两处共用一份实现（含"无分组 key 被网关 403 时改绑套餐分组重试"的兜底），避免漂移。
  const relayLogin = async () => {
    setBusy(true); setStatus("");
    const result = await performRelayLogin({
      baseUrl: relayDraft.baseUrl,
      email: relayDraft.email,
      password: relayDraft.password,
      username: username.trim() || undefined,
      onLogin,
    });
    if (!result.ok) setStatus(result.message ?? "中转站登录失败");
    setBusy(false);
  };

  // OpenAI 官方订阅：设备码登录 → 收进账号库 → 写 auth.json + 重启引擎 → 自动配置进主界面
  const openaiLogin = async () => {
    setBusy(true); setStatus("");
    try {
      const proxyValue = openaiProxy.trim();
      if (proxyValue) localStorage.setItem("openai-proxy", proxyValue); else localStorage.removeItem("openai-proxy");
      void window.codex.openaiSetProxy(proxyValue).catch(() => undefined);
      await window.codex.openaiLoginStart({ proxy: proxyValue || undefined });
      let opened = false;
      const openAuth = (url: string) => {
        if (opened || !url) return;
        opened = true;
        void window.codex.openExternal(url).catch((e: any) => setStatus("打开浏览器失败：" + (e.message ?? e) + "，请手动访问 " + url));
      };
      const first = await window.codex.openaiLoginStatus();
      setOpenaiDevice({ url: first.url, code: first.code, raw: first.lines });
      if (first.error) setStatus("登录失败：" + first.error + "。OpenAI 有区域限制——请确认代理已开启，或填好代理地址后重试。");
      openAuth(first.url);
      const startedAt = Date.now();
      if (openaiTimerRef.current) window.clearInterval(openaiTimerRef.current);
      openaiTimerRef.current = window.setInterval(async () => {
        const s = await window.codex.openaiLoginStatus();
        setOpenaiDevice({ url: s.url, code: s.code, raw: s.lines });
        openAuth(s.url);
        if (s.error && !s.childAlive && !s.loggedIn) {
          if (openaiTimerRef.current) window.clearInterval(openaiTimerRef.current);
          openaiTimerRef.current = null;
          setStatus("登录失败：" + s.error + "。OpenAI 有区域限制——请确认代理已开启，或填好代理地址后重试。");
          setBusy(false);
        }
        if (s.loggedIn) {
          if (openaiTimerRef.current) window.clearInterval(openaiTimerRef.current);
          openaiTimerRef.current = null;
          setOpenaiDevice(null);
          const saved = await window.codex.openaiCaptureLogin();
          await window.codex.openaiAccountSwitch(saved.id);
          const ok = await onLogin({ provider: "openai-official", name: "OpenAI 官方订阅", baseUrl: "https://chatgpt.com/backend-api/codex", apiKey: "", model: "", username: username.trim() || undefined });
          if (!ok) setStatus("订阅启用失败，请稍后在 设置 → 模型 重试");
        } else if (Date.now() - startedAt > 15 * 60_000) {
          if (openaiTimerRef.current) window.clearInterval(openaiTimerRef.current);
          openaiTimerRef.current = null;
          void window.codex.openaiLoginCancel();
        }
      }, 2500);
    } catch (error: any) { setStatus("OpenAI 登录失败：" + (error.message ?? error)); }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand"><div className="brand-mark login-logo"><b className="">CH</b></div><div><strong>Codex Harness</strong><span>Desktop</span></div></div>
        <h1>欢迎使用 Codex Harness</h1>
        <p className="login-sub">配置 API 即可开始；暂不登录可直接体验主界面</p>

        <div className="login-options">
          <button type="button" className={`login-option ${mode === "pptoken" ? "active" : ""}`} onClick={() => { setMode("pptoken"); setEndpointOpen(false); queueMicrotask(() => apiKeyRef.current?.focus()); }}>
            <Rocket size={16} /><span className="login-option-title">PPtoken 推荐</span><small>中转线路 · 粘贴 Key 即用</small>
          </button>
          <button type="button" className={`login-option ${mode === "openai" ? "active" : ""}`} onClick={() => { setMode("openai"); setEndpointOpen(false); }}>
            <CircleGauge size={16} /><span className="login-option-title">OpenAI 官方订阅</span><small>ChatGPT 账号设备码登录</small>
          </button>
          <button type="button" className={`login-option ${mode === "relay" ? "active" : ""}`} onClick={() => { setMode("relay"); setEndpointOpen(false); }}>
            <Wallet size={16} /><span className="login-option-title">中转站账户</span><small>sub2api 网关 · 余额/套餐</small>
          </button>
          <button type="button" className={`login-option ${mode === "custom" ? "active" : ""}`} onClick={() => { setMode("custom"); setEndpointOpen(false); queueMicrotask(() => { apiBaseRef.current?.focus(); apiBaseRef.current?.select(); }); }}>
            <Settings2 size={16} /><span className="login-option-title">自定义 API</span><small>任意 OpenAI 兼容端点</small>
          </button>
        </div>

        {mode === "openai" ? (
          <div className="login-fields">
            <p className="relay-login-hint">点击下方按钮后浏览器会打开 OpenAI 授权页，输入验证码即可；登录成功自动启用 Codex 订阅并进入主界面。OpenAI 有区域限制，需要可访问 OpenAI 的网络（代理）。</p>
            <label className="se-field"><span>用户名（选填）</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="怎么称呼你？登录后显示在界面左上角" />
            </label>
            <label className="se-field"><span>代理地址（可选）</span>
              <input value={openaiProxy} onChange={(e) => setOpenaiProxy(e.target.value)} placeholder="http://127.0.0.1:7890" />
            </label>
        {openaiDevice && (
              <div className="official-device openai-device-panel">
                {openaiDevice.url && <>浏览器已打开授权页，输入验证码：<b>{openaiDevice.code || "见下方引擎输出"}</b></>}
                {!openaiDevice.url && "正在向 OpenAI 申请设备验证码…"}
                {openaiDevice.raw && <pre className="official-usage">{openaiDevice.raw}</pre>}
              </div>
            )}
          </div>
        ) : mode === "relay" ? (
          <div className="login-fields">
            <label className="se-field"><span>中转站地址（sub2api 网关）</span>
              <input value={relayDraft.baseUrl} onChange={(e) => setRelayDraft({ ...relayDraft, baseUrl: e.target.value })} placeholder="https://api.pptoken.cc" />
            </label>
            <label className="se-field"><span>邮箱</span>
              <input value={relayDraft.email} onChange={(e) => setRelayDraft({ ...relayDraft, email: e.target.value })} placeholder="你在中转站的账号邮箱" />
            </label>
            <label className="se-field"><span>密码</span>
              <input type="password" value={relayDraft.password} onChange={(e) => setRelayDraft({ ...relayDraft, password: e.target.value })} placeholder="中转站账号密码" onKeyDown={(e) => { if (e.key === "Enter" && relayDraft.email && relayDraft.password && !busy) void relayLogin(); }} />
            </label>
            <p className="relay-login-hint">登录后自动同步余额与订阅套餐，优先使用生效中的套餐（无套餐走余额），并生成好供应商直接开聊；后续可在 设置 → 中转站 切换计费方式。</p>
          </div>
        ) : (
        <div className="login-fields">
          <label className="se-field"><span>用户名（选填）</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="怎么称呼你？登录后显示在界面左上角" />
          </label>

          {mode === "pptoken" ? (
            <label className="se-field"><span>API 端点</span>
              <div className={`login-endpoint-select ${endpointOpen ? "open" : ""}`} ref={endpointRef}>
                <button type="button" className="login-endpoint-trigger" onClick={() => setEndpointOpen((open) => !open)} aria-expanded={endpointOpen}>
                  <span><b>{PPTokenEndpoints[endpoint].label}</b><small>{PPTokenEndpoints[endpoint].url}</small></span><ChevronDown size={15} />
                </button>
                {endpointOpen && <div className="login-endpoint-menu" role="listbox">{PPTokenEndpoints.map((option, index) => <button type="button" role="option" aria-selected={index === endpoint} className={index === endpoint ? "active" : ""} key={option.id} onClick={() => { setEndpoint(index); setApiBase(option.url); setEndpointOpen(false); }}><span><b>{option.label}</b><small>{option.url}</small></span>{index === endpoint && <Check size={14} />}</button>)}</div>}
              </div>
            </label>
          ) : (
            <label className="se-field"><span>API 地址</span>
              <input ref={apiBaseRef} autoFocus value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://api.example.com/v1" />
            </label>
          )}

          <label className="se-field"><span>API 密钥</span>
            <div className="pw-wrap"><input ref={apiKeyRef} type={showPw ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." /><button type="button" className="pw-toggle" onClick={() => setShowPw(!showPw)}>{showPw ? "隐藏" : "显示"}</button></div>
          </label>
        </div>
        )}

        {status && <div className="login-status">{status}</div>}

        {mode === "openai" ? (
          <button className="primary-setting login-btn" disabled={busy} onClick={() => void openaiLogin()}>
            {busy ? <><Spinner />等待浏览器登录…</> : <><CircleGauge size={15} />登录并启用订阅</>}
          </button>
        ) : mode === "relay" ? (
          <button className="primary-setting login-btn" disabled={!relayDraft.baseUrl.trim() || !relayDraft.email.trim() || !relayDraft.password.trim() || busy} onClick={() => void relayLogin()}>
            {busy ? <><Spinner />正在登录中转站…</> : <><Wallet size={15} />登录并自动配置</>}
          </button>
        ) : (
        <button className="primary-setting login-btn" disabled={!apiBase.trim() || !apiKey.trim() || busy} onClick={() => { const selected = PPTokenEndpoints[endpoint]; void doLogin(mode === "pptoken" ? selected.id : `custom-login-${Date.now()}`, mode === "pptoken" ? selected.name : "自定义 API", apiBase.trim().replace(/\/$/, ""), apiKey.trim()); }}>
          {busy ? <><Spinner />正在探测模型…</> : <><KeyRound size={15} />探测并登录</>}
        </button>
        )}
        <button className="ghost login-skip" onClick={onSkip}><WifiOff size={14} />暂时不登录，直接进入</button>
        <a className="login-sponsor-link" href="https://api.pptoken.cc/register?aff=X82JSNVC3W3S" onClick={(event) => { event.preventDefault(); void window.codex.openExternal("https://api.pptoken.cc/register?aff=X82JSNVC3W3S"); }}>
          <Rocket size={12} />没有 API Key？注册 PPtoken 领取体验额度<ExternalLink size={11} />
        </a>
        <div className="login-foot">探测成功后会自动导入模型并完成配置</div>
      </div>
    </div>
  );
}
