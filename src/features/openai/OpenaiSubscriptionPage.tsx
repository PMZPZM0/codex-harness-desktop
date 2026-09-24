/**
 * OpenaiSubscriptionPage —— 保留未分出的部分（09-22 结构改造）。
 * ⛔ 顺序即契约（若含 hook / 副作用注册，调用顺序 == 原文件顺序）⇒ 只能按文件名前缀顺序 import。
 */
import { CircleGauge, Clock3, AlertTriangle, Bot, Check, Play, LogIn, Trash2, Plus, FileUp, X, RefreshCw } from "lucide-react";
import { OFFICIAL_MODELS } from "../../lib/official-models";
import { PageInfo } from "../../components/SettingsHead";
import { Spinner } from "../../components/CardShell";
import { useState, useRef, useCallback, useEffect } from "react";
import { parseOpenaiUsagePanel, openaiResetText, extractQuotaBars } from "./OpenaiSubscriptionPage/01-usage-parsers";
export { OpenaiBalanceBadge } from "./OpenaiSubscriptionPage/02-official-cards";

export function OpenaiSubscriptionPage({ activeProvider, onActivate, onNotice, onActiveChange, onRefreshActive, openAppConfirm }: { activeProvider?: string; onActivate: (models: string[]) => Promise<void> | void; onNotice: (m: string) => void; onActiveChange?: (email: string) => void; onRefreshActive?: () => unknown; openAppConfirm: (title: string, text: string, confirmLabel?: string) => Promise<boolean> }) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [device, setDevice] = useState<{ url: string; code: string; raw?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState("");
  const [err, setErr] = useState("");
  const [usageMap, setUsageMap] = useState<Record<string, string>>({});
  const [manageOpen, setManageOpen] = useState(false);
  const [manageEmail, setManageEmail] = useState("");
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [proxy, setProxy] = useState(() => localStorage.getItem("openai-proxy") ?? "");
  const timerRef = useRef<number | null>(null);
  useEffect(() => { const t = window.setInterval(() => setNowTick(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  const authOpenedRef = useRef(false);
  // 导入账号文件直接登录（复刻 sub2api 的 Codex 导入格式面）：裸 accessToken 文本 /
  // Codex CLI auth.json / 扁平 JSON，多选一次导入；导入即切换生效（写 auth.json + 重启引擎 + 启用订阅）。
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const onImportFiles = async (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setImporting(true); setErr("");
    try {
      const contents: string[] = [];
      for (const file of list) contents.push(await file.text());
      const result = await window.codex.openaiImportFile({ contents });
      const okItems = result.items.filter((i) => i.action !== "failed");
      const failText = result.items.filter((i) => i.action === "failed").map((i) => `#${i.index} ${i.message ?? ""}`).join("；");
      if (!okItems.length) throw new Error(failText || "没有可识别的账号条目（支持 auth.json、扁平 token JSON、每行一个 accessToken）");
      await reload();
      // 导入即登录：切到第一个「可登录」条目（带 id_token，写 auth.json 后引擎才认）；
      // 裸 token 条目只入 vault 作存档，不能构成登录态。切换后必须再刷一次：账号卡的
      // 「使用中」徽章读的是这次 reload 的 active 快照。
      const first = okItems.find((i) => i.id && i.loginable);
      if (first?.id) {
        const sw = await window.codex.openaiAccountSwitch(first.id);
        await onActivate(OFFICIAL_MODELS);
        onActiveChange?.(sw.email);
        await reload();
        onNotice(`导入完成：新增 ${result.imported}、更新 ${result.updated}、失败 ${result.failed}；已切换登录 ${sw.email}，可以直接对话`);
      } else {
        onNotice(`导入完成：新增 ${result.imported}、更新 ${result.updated}、失败 ${result.failed}`);
      }
    } catch (e: any) {
      setErr("导入失败：" + (e.message ?? e));
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };
  const reload = useCallback(async () => {
    try { const list = await window.codex.openaiAccounts(); setAccounts(list); return list as { id: string; email: string; loggedIn?: boolean }[]; } catch { setAccounts([]); return []; }
  }, []);
  const loadUsage = useCallback(async (email: string) => {
    try {
      const raw = JSON.stringify(await window.codex.openaiUsage({ email }), null, 1);
      setUsageMap((m) => ({ ...m, [email]: raw }));
    } catch (e: any) { setUsageMap((m) => ({ ...m, [email]: "ERR:" + (e.message ?? e) })); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current); }, []);
  // 账号列表加载后自动为每个账号拉一次额度
  useEffect(() => {
    const t = window.setTimeout(() => { accounts.forEach((a) => { if (!usageMap[a.email]) void loadUsage(a.email); }); }, 800);
    return () => window.clearTimeout(t);
  }, [accounts]);
  // 实时同步：60s 轮询全部账号额度（与中转站余额徽标同节奏）
  useEffect(() => {
    if (!accounts.length) return;
    const t = window.setInterval(() => { accounts.forEach((a) => void loadUsage(a.email)); }, 60_000);
    return () => window.clearInterval(t);
  }, [accounts, loadUsage]);
  // 浏览器打开一次即可（授权 URL 首次出现时触发）
  const openAuthOnce = (url: string) => {
    if (authOpenedRef.current || !url) return;
    authOpenedRef.current = true;
    void window.codex.openExternal(url).catch((e: any) => setErr("打开浏览器失败：" + (e.message ?? e) + "，请手动访问 " + url));
  };
  const startLogin = async () => {
    setBusy(true); setErr("");
    try {
      const proxyValue = proxy.trim();
      if (proxyValue) localStorage.setItem("openai-proxy", proxyValue); else localStorage.removeItem("openai-proxy");
      await window.codex.openaiSetProxy(proxyValue).catch(() => undefined);
      await window.codex.openaiLoginStart({ proxy: proxyValue || undefined });
      const first = await window.codex.openaiLoginStatus();
      setDevice({ url: first.url, code: first.code, raw: first.lines });
      if (first.error) setErr("登录失败：" + first.error + "。OpenAI 有区域限制——请确认代理已开启（本机检测到 7897 端口代理，填 http://127.0.0.1:7897），或换正确端口后重试。");
      openAuthOnce(first.url);
      const startedAt = Date.now();
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(async () => {
        const s = await window.codex.openaiLoginStatus();
        setDevice({ url: s.url, code: s.code, raw: s.lines });
        openAuthOnce(s.url);
        if (s.error && !s.childAlive && !s.loggedIn) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          timerRef.current = null;
          setErr("登录失败：" + s.error + "。OpenAI 有区域限制——请确认代理已开启后重试。");
          setBusy(false);
        }
        if (s.loggedIn) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          timerRef.current = null;
          setDevice(null);
          const saved = await window.codex.openaiCaptureLogin();
          await reload();
          // 登录即生效：写入 auth.json + 重启引擎 + 自动配置官方订阅模型，直接可对话
          try {
            await window.codex.openaiAccountSwitch(saved.id);
            onActiveChange?.(saved.email);
            await onActivate(OFFICIAL_MODELS);
            onNotice("OpenAI 账号已登录并启用订阅：" + saved.email + "，可以直接开始对话");
          } catch (e: any) {
            setErr("账号已保存，但自动启用失败：" + (e.message ?? e));
          }
        } else if (Date.now() - startedAt > 15 * 60_000) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          timerRef.current = null;
          void window.codex.openaiLoginCancel();
        }
      }, 2500);
    } catch (e: any) { setErr("官方登录失败：" + (e.message ?? e)); } finally { setBusy(false); }
  };
  const switchAccount = async (id: string) => {
    setWorking("sw" + id); setErr("");
    try {
      const r = await window.codex.openaiAccountSwitch(id);
      onActiveChange?.(r.email);
      onNotice("已切换官方账号：" + r.email + "，引擎已重启");
    } catch (e: any) { setErr("切换失败：" + (e.message ?? e)); } finally { setWorking(""); }
  };
  // 删除订阅账号：二次确认（09-21）。OpenAI 账号删掉就只剩 vault 里的 tokens —— 站方那边
  // 不受影响，但要重新走一次设备码登录，所以确认文案把这点写清楚。
  const removeAccount = async (target: { id: string; email?: string; active?: boolean }) => {
    const label = target.email || target.id;
    const ok = await openAppConfirm(
      "删除 OpenAI 账号",
      `确认从本机删除「${label}」？\n\n· 本机保存的登录 token 会被清除，以后要重新走设备码登录\n· OpenAI 账号本身与订阅不受影响\n${target.active ? "· 它是当前生效账号：会退出订阅生效并重启引擎一次\n" : ""}`,
      "删除"
    );
    if (!ok) return;
    setWorking("rm" + target.id); setErr("");
    try { await window.codex.openaiAccountRemove(target.id); await reload(); onNotice("账号已删除"); } catch (e: any) { setErr("删除失败：" + (e.message ?? e)); } finally { setWorking(""); }
  };
  const enableSubscription = async (id: string) => {
    setWorking("en" + id); setErr("");
    try {
      const r = await window.codex.openaiAccountSwitch(id);
      onActiveChange?.(r.email);
      await onActivate(OFFICIAL_MODELS);
      onNotice("已启用 " + r.email + " 的 Codex 订阅");
    } catch (e: any) { setErr("启用失败：" + (e.message ?? e)); } finally { setWorking(""); }
  };
  // 账号启用/停用：停用 = 退出切换候选（vault 数据保留）；停用使用中的账号会同步退出引擎生效。
  // 重新启用时若当前没有任何生效的官方账号（停用会清 auth.json），自动恢复该账号订阅生效——
  // 与中转站开关同语义：开关=暂停/恢复，不该让用户再手动点「启用订阅」（09-09）
  const toggleAccount = async (id: string, enabled: boolean) => {
    setWorking("tg" + id); setErr("");
    try {
      const r = await window.codex.openaiToggleAccount({ id, disabled: !enabled });
      const list = await reload();
      if ((r as any).deactivated) {
        onActiveChange?.("");
        // 主进程停用生效账号时已把 openai-official 条目停用 + custom-model.json 清空；
        // 这里刷新 App 的 customModel 状态，否则互斥判断还挂着旧供应商，其他供应商启用按钮被置灰
        await onRefreshActive?.();
        onNotice("账号已停用，官方订阅已退出引擎（重新打开开关可恢复）");
        return;
      }
      const target = (list ?? []).find((a: any) => a.id === id);
      if (enabled) {
        // 全局互斥：启用 A 时自动停用其他已启用的账号（一次只能开一个）
        for (const other of (list ?? []) as any[]) {
          if (other.id !== id && other.disabled !== true) {
            await window.codex.openaiToggleAccount({ id: other.id, disabled: true }).catch(() => undefined);
          }
        }
      }
      if (enabled && target) {
        // 没有任何生效的官方账号：自动把刚启用的账号恢复为当前订阅（vault 内账号必有登录态）
        onNotice("账号已启用，正在自动恢复官方订阅…");
        setWorking("en" + id);
        const sw = await window.codex.openaiAccountSwitch(id);
        onActiveChange?.(sw.email);
        await onActivate(OFFICIAL_MODELS);
        onNotice("账号已启用并恢复为当前生效：" + sw.email);
      } else {
        onNotice(enabled ? "账号已启用，可启用其 Codex 订阅" : "账号已停用，不再出现在切换候选中");
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+':\s*/i, ""));
      await reload();
    } finally { setWorking(""); }
  };
  return (
    <section className="settings-section stack relay-center">
      <div className="settings-copy channel-heading"><div><h2>OpenAI 订阅监控<PageInfo text={<>多账号统一监控：每张卡片实时显示订阅档位、有效期与额度用量；切换账号即写入引擎并重启生效。登录与额度查询需要可访问 OpenAI 的网络（代理）。</>} /></h2></div></div>
      {err && <p className="relay-account-err"><AlertTriangle size={13} />{err}</p>}
      <div className="relay-plan-grid openai-account-grid">
        {accounts.map((a) => {
          const usageRaw = usageMap[a.email];
          let bars: { label: string; value: number; resetAt?: number }[] = [];
          if (usageRaw && !usageRaw.startsWith("ERR:")) {
            try {
              const parsed = JSON.parse(usageRaw);
              const panel = parseOpenaiUsagePanel(parsed);
              bars = panel.windows.map((w) => ({ label: w.label, value: w.usedPercent, resetAt: w.resetAt }));
              if (!bars.length) bars = extractQuotaBars(parsed).map((b) => ({ label: b.label, value: b.value }));
            } catch { bars = []; }
          }
          const primary = bars[0];
          // 与中转站卡片同一不变量：停用账号永不显示「使用中 / 生效」
          const live = Boolean(a.active) && !a.disabled;
          return (
            <div className={`relay-plan-card openai-account-card ${live ? "selected" : ""}${a.disabled ? " acct-disabled" : ""}`} key={a.id} onClick={() => { setManageEmail(a.email); setManageOpen(true); if (!usageRaw) void loadUsage(a.email); }} title="点卡片进入监控面板">
              <div className="relay-plan-card-head">
                <Bot size={15} />
                <strong title={a.email}>{a.email || a.id}</strong>
                {a.planType ? <span className="openai-plan-badge">{a.planType.toUpperCase()}</span> : null}
                {live && <span className="relay-plan-live"><Check size={11} />使用中</span>}
                {a.disabled && <span className="acct-disabled-badge">已停用</span>}
                <label className="bot-switch acct-switch" title={a.disabled ? (activeProvider && !a.active ? `已有供应商生效（一次只能启用一个），先停用再启用这个账号` : "已停用，点击启用") : "启用中，点击停用"} onClick={(event) => event.stopPropagation()}>
                  <input type="checkbox" checked={!a.disabled} disabled={working === "tg" + a.id || (a.disabled && Boolean(activeProvider) && !a.active)} onChange={(event) => void toggleAccount(a.id, event.target.checked)} /><span />
                </label>
              </div>
              <p className="openai-sub-line">订阅{a.subscriptionUntil ? "至 " + a.subscriptionUntil.slice(0, 10) : "生效中"} · {new Date(a.savedAt).toLocaleString()} 登录</p>
              {primary ? (
                <div className="">
                  <div className="openai-quota-bar-label"><span>{primary.label}</span><b>{Math.round(primary.value)}%</b></div>
                  <div className="relay-plan-progress"><i style={{ width: Math.min(100, primary.value) + "%" }} /></div>
                {primary.resetAt ? <div className="openai-reset-line"><Clock3 size={10} />{openaiResetText(primary.resetAt, nowTick)}</div> : null}
                </div>
              ) : <p className="openai-sub-line">点卡片查看额度监控面板</p>}
              <div className="relay-plan-card-foot">
                <span className="relay-plan-live openai-card-hint"><CircleGauge size={11} />监控面板</span>
                {!live && <button className="secondary-setting" disabled={working !== "" || a.disabled} title={a.disabled ? "已停用的账号不能启用订阅，请先在卡片上重新启用" : undefined} onClick={(event) => { event.stopPropagation(); void enableSubscription(a.id); }}>{working === "en" + a.id ? <Spinner /> : <Play size={13} />}启用订阅</button>}
                {/* 删除入口搬到卡片上（原先只在监控面板里、还是图标，用户找不到） */}
                <button className="secondary-setting relay-account-remove" title={`删除账号「${a.email || a.id}」（会二次确认）`} disabled={working !== ""} onClick={(event) => { event.stopPropagation(); void removeAccount(a); }}><Trash2 size={13} />删除</button>
              </div>
            </div>
          );
        })}
        {!accounts.length && <div className="relay-plan-card"><div className="relay-plan-card-head"><Bot size={15} /><strong>暂无已保存账号</strong></div><p>点下方「添加 OpenAI 账号」设备码登录，或「导入账号文件」用已有的 auth.json / token 直接登入。</p></div>}
        <button className="relay-plan-card relay-add-card" onClick={() => setLoginModalOpen(true)}>
          <Plus size={18} />
          <strong>添加 OpenAI 账号</strong>
          <small>ChatGPT 设备码登录 · 自动启用订阅</small>
        </button>
        <button className="relay-plan-card relay-add-card" disabled={importing} title="支持 Codex CLI 的 auth.json、扁平 token JSON、每行一个 accessToken 的文本（可多选）；导入后自动登录生效" onClick={() => importInputRef.current?.click()}>
          {importing ? <Spinner /> : <FileUp size={18} />}
          <strong>导入账号文件</strong>
          <small>auth.json / token 文本 · 导入即登录生效</small>
        </button>
        <input ref={importInputRef} type="file" multiple accept=".json,.txt,.jsonl,application/json,text/plain" style={{ display: "none" }} onChange={(event) => void onImportFiles(event.target.files)} />
      </div>
      {manageOpen && (() => {
        const a = accounts.find((x) => x.email === manageEmail);
        if (!a) return null;
        const usageRaw = usageMap[a.email];
        let bars: { label: string; value: number; resetAt?: number }[] = [];
        if (usageRaw && !usageRaw.startsWith("ERR:")) {
          try {
            const parsed = JSON.parse(usageRaw);
            const panel = parseOpenaiUsagePanel(parsed);
            bars = panel.windows.map((w) => ({ label: w.label, value: w.usedPercent, resetAt: w.resetAt }));
            if (!bars.length) bars = extractQuotaBars(parsed).map((b) => ({ label: b.label, value: b.value }));
          } catch { bars = []; }
        }
        return (
          <div className="relay-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setManageOpen(false); }}>
            <div className="relay-manage-modal">
              <div className="relay-keys-head">
                <strong className="relay-modal-title"><Bot size={15} />{a.email || a.id}</strong>
                {a.planType ? <span className="openai-plan-badge">{a.planType.toUpperCase()}</span> : null}
                {a.active && !a.disabled && <span className="relay-plan-live"><Check size={11} />使用中</span>}
                {a.disabled && <span className="acct-disabled-badge">已停用</span>}
                <button className="icon-button relay-modal-close" title="关闭" onClick={() => setManageOpen(false)}><X size={15} /></button>
              </div>
              <p className="openai-sub-line">订阅{a.subscriptionUntil ? "至 " + a.subscriptionUntil.slice(0, 10) : "生效中"} · {new Date(a.savedAt).toLocaleString()} 登录 · 额度与官方实时同步</p>
              {usageRaw && !usageRaw.startsWith("ERR:") && bars.length > 0 && (
                <div className="openai-quota-bars">
                  {bars.map((bar) => (
                    <div className="" key={bar.label}>
                      <div className="openai-quota-bar-label"><span>{bar.label}</span><b>{Math.round(bar.value)}%</b></div>
                      <div className="relay-plan-progress"><i style={{ width: Math.min(100, bar.value) + "%" }} /></div>
                      {bar.resetAt ? <div className="openai-reset-line"><Clock3 size={10} />{openaiResetText(bar.resetAt, nowTick)}</div> : null}
                    </div>
                  ))}
                </div>
              )}
              {usageRaw && !usageRaw.startsWith("ERR:") && bars.length === 0 && <p className="openai-sub-line">官方未返回百分比额度数据（可能尚未产生用量）。</p>}
              {usageRaw && usageRaw.startsWith("ERR:") && <p className="openai-sub-line openai-quota-err">{usageRaw.slice(4)}</p>}
              <div className="relay-plan-card-foot">
                <button className="secondary-setting" disabled={working !== ""} onClick={() => void loadUsage(a.email)}><RefreshCw size={13} />刷新额度</button>
                {a.active && !a.disabled
                  ? <button className="secondary-setting" disabled={working !== ""} onClick={() => void onActivate(OFFICIAL_MODELS)}>{working === "en" + a.id ? <Spinner /> : <Play size={13} />}重新启用</button>
                  : <button className="secondary-setting" disabled={working !== "" || a.disabled || Boolean(activeProvider)} title={a.disabled ? "已停用的账号不能启用订阅，请先在卡片上重新启用" : (activeProvider ? `已有供应商「${activeProvider}」生效，请先停用再启用 OpenAI 订阅` : undefined)} onClick={() => void enableSubscription(a.id)}>{working === "en" + a.id ? <Spinner /> : <Play size={13} />}启用订阅</button>}
                <button className="secondary-setting relay-account-remove" title={`删除账号「${a.email || a.id}」（会二次确认）`} disabled={working !== ""} onClick={() => void removeAccount(a)}><Trash2 size={13} />删除</button>
              </div>
              <p className="relay-center-foot">启用 = 写入引擎并重启生效，直接可对话；额度数据来自 chatgpt.com 后端（wham/usage）。</p>
            </div>
          </div>
        );
      })()}
      {loginModalOpen && (
        <div className="relay-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setLoginModalOpen(false); }}>
          <div className="relay-manage-modal relay-login-modal">
            <div className="relay-keys-head">
              <strong className="relay-modal-title"><LogIn size={15} />添加 OpenAI 账号</strong>
              <small>设备码登录 · 自动收进账号库并启用订阅</small>
              <button className="icon-button relay-modal-close" title="关闭" onClick={() => setLoginModalOpen(false)}><X size={15} /></button>
            </div>
            <p className="openai-sub-line">点击登录后浏览器会打开 OpenAI 授权页，输入验证码即可；登录成功自动启用订阅并进入可用状态。OpenAI 有区域限制，需要可访问 OpenAI 的网络（代理）。</p>
            <div className="relay-key-form openai-add-row">
              <input value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="代理地址（可选，如 http://127.0.0.1:7897）" />
              <button className="primary-setting" disabled={busy} onClick={() => void startLogin()}>{busy ? <><Spinner />等待浏览器登录…</> : <><LogIn size={14} />设备码登录</>}</button>
            </div>
            {device && (
              <div className="official-device openai-device-panel">
                {device.url && <>浏览器已打开授权页，输入验证码：<b>{device.code || "见下方引擎输出"}</b></>}
                {!device.url && "正在向 OpenAI 申请设备验证码…"}
                {device.raw ? <pre className="official-usage">{device.raw}</pre> : null}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
