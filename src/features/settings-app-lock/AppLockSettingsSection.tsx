/**
 * 设置 → 应用锁（10-26 用户令）。
 *
 * 默认关闭；开启时二选一：随机密码 / 自定义密码。密码**只在开启流程里展示一次**，
 * 主进程只存 scrypt 加盐哈希；忘记密码只能连续输错 10 次 → 清空应用数据重置。
 *
 * ⛔ 渲染层不存密码、不缓存哈希；准备阶段的明文只留在本次 React state，确认或取消后立刻丢掉。
 * ⛔ 密码框一律 type=password；「只显示一次」的展示框允许点「复制」。
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, KeyRound, LoaderCircle, Lock, RefreshCw, ShieldAlert, ShieldCheck, Sparkles, X } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
import { ToggleSwitch } from "../../components/SettingsWidgets";
import { SettingsGroupHead, SettingsPageHero } from "../../components/SettingsPageHero";

type LockStatus = Awaited<ReturnType<typeof window.codex.appLockStatus>>;
type Prepared = { setupId: string; password: string; kind: "random" | "custom" };
type DisableIntent = "off" | "change";

function displayPassword(password: string, kind: "random" | "custom"): string {
  return kind === "random" ? password.replace(/(.{4})/g, "$1 ").trim() : password;
}

export function AppLockSettingsSection({ onNotice }: { onNotice?: (text: string) => void }) {
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [loadError, setLoadError] = useState("");

  const [setupOpen, setSetupOpen] = useState(false);
  const [mode, setMode] = useState<"random" | "custom">("random");
  const [custom1, setCustom1] = useState("");
  const [custom2, setCustom2] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [ack, setAck] = useState(false);
  const [copied, setCopied] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState("");

  const [disableOpen, setDisableOpen] = useState(false);
  const [disableIntent, setDisableIntent] = useState<DisableIntent>("off");
  const [disablePassword, setDisablePassword] = useState("");
  const [disableBusy, setDisableBusy] = useState(false);
  const [disableError, setDisableError] = useState("");
  const [disableReset, setDisableReset] = useState(false);

  const refresh = useCallback(async () => {
    setLoadError("");
    try {
      const next = await window.codex.appLockStatus();
      setStatus(next);
      if (next.enabled && next.resetRequired) setDisableReset(true);
    } catch (error: any) {
      setLoadError(String(error?.message ?? error ?? "读取应用锁状态失败"));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!setupOpen && !disableOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (setupBusy || disableBusy) return;
      if (setupOpen) closeSetup();
      else closeDisable();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [setupOpen, disableOpen, setupBusy, disableBusy, prepared]);

  const openEnable = () => {
    setMode("random");
    setCustom1("");
    setCustom2("");
    setPrepared(null);
    setAck(false);
    setCopied(false);
    setSetupError("");
    setSetupOpen(true);
  };

  const closeSetup = () => {
    if (prepared) void window.codex.appLockCancel(prepared.setupId).catch(() => undefined);
    setSetupOpen(false);
    setPrepared(null);
    setCustom1("");
    setCustom2("");
    setAck(false);
    setCopied(false);
    setSetupError("");
  };

  const prepare = async () => {
    if (setupBusy) return;
    setSetupError("");
    if (mode === "custom") {
      if (custom1.trim().length < 6) { setSetupError("密码至少 6 位"); return; }
      if (custom1 !== custom2) { setSetupError("两次输入的密码不一致"); return; }
    }
    setSetupBusy(true);
    try {
      const result = await window.codex.appLockPrepare({ mode, password: mode === "custom" ? custom1 : undefined });
      if (!result.ok || !result.setupId || !result.password) {
        setSetupError(result.error ?? "生成密码失败");
        return;
      }
      setPrepared({ setupId: result.setupId, password: result.password, kind: result.kind === "random" ? "random" : "custom" });
      setAck(false);
      setCopied(false);
    } catch (error: any) {
      setSetupError(String(error?.message ?? error ?? "生成密码失败"));
    } finally {
      setSetupBusy(false);
    }
  };

  const commit = async () => {
    if (!prepared || !ack || setupBusy) return;
    setSetupBusy(true);
    setSetupError("");
    try {
      const result = await window.codex.appLockEnable(prepared.setupId);
      if (!result.ok) { setSetupError(result.error ?? "开启失败"); return; }
      setSetupOpen(false);
      setPrepared(null);
      setCustom1("");
      setCustom2("");
      setAck(false);
      await refresh();
      onNotice?.("应用锁已开启：请确认密码已备份");
    } catch (error: any) {
      setSetupError(String(error?.message ?? error ?? "开启失败"));
    } finally {
      setSetupBusy(false);
    }
  };

  const copyPassword = async () => {
    if (!prepared) return;
    try {
      await copyTextToClipboard(prepared.password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* 复制失败时用户仍可手抄，界面保留明文 */ }
  };

  const openDisable = (intent: DisableIntent) => {
    setDisableIntent(intent);
    setDisablePassword("");
    setDisableError("");
    setDisableReset(false);
    setDisableOpen(true);
  };

  const closeDisable = () => {
    setDisableOpen(false);
    setDisablePassword("");
    setDisableError("");
  };

  const submitDisable = async () => {
    if (disableBusy || !disablePassword.trim()) return;
    setDisableBusy(true);
    setDisableError("");
    try {
      const result = await window.codex.appLockDisable(disablePassword);
      if (result.ok) {
        setDisableOpen(false);
        setDisablePassword("");
        await refresh();
        if (disableIntent === "change") { openEnable(); return; }
        onNotice?.("应用锁已关闭");
        return;
      }
      if (result.reset) { setDisableReset(true); return; }
      setDisableError(`密码错误，还可尝试 ${result.remaining} 次`);
      setDisablePassword("");
    } catch (error: any) {
      setDisableError(String(error?.message ?? error ?? "关闭失败"));
    } finally {
      setDisableBusy(false);
    }
  };

  const lockNow = () => {
    try { sessionStorage.removeItem("app-lock-skip-boot"); } catch { /* 忽略 */ }
    window.location.reload();
  };

  const enabled = Boolean(status?.enabled);
  const kindLabel = status?.kind === "random" ? "随机密码" : "自定义密码";
  const createdLabel = status?.createdAt ? new Date(status.createdAt).toLocaleString("zh-CN") : "";

  return (
    <section className="settings-section stack settings-exp-page app-lock-page">
      <SettingsPageHero
        icon={<Lock size={20} />}
        title="应用锁"
        subtitle="给应用加一道本机密码门：开启后每次启动/重新显示都要先解锁，密码只展示一次。"
        hint={enabled ? "已开启" : "默认关闭"}
      />

      <SettingsGroupHead title="应用密码锁" hint="本机生效 · 密码只存哈希" />
      <div className="settings-exp-card app-lock-status-card">
        <div className="settings-card">
          <div className="settings-card-head">
            <Lock size={15} />
            <strong>应用密码锁</strong>
            <span className="settings-subhead-hint">{enabled ? "已开启" : "默认关闭"}</span>
            <ToggleSwitch
              className="app-lock-toggle"
              checked={enabled}
              disabled={!status || setupBusy || disableBusy}
              label="应用锁"
              onChange={(next) => { if (next) openEnable(); else openDisable("off"); }}
            />
          </div>
          <div className="settings-card-body">
            {loadError ? (
              <div className="app-lock-inline-error"><ShieldAlert size={14} />{loadError}<button type="button" className="secondary-setting" onClick={() => void refresh()}><RefreshCw size={13} />重试</button></div>
            ) : !status ? (
              <div className="app-lock-loading"><LoaderCircle size={14} className="spin" />正在读取状态…</div>
            ) : enabled ? (
              <>
                <div className="app-lock-status-row">
                  <span className="app-lock-badge"><ShieldCheck size={13} />已开启</span>
                  <span className="app-lock-meta">{kindLabel}{createdLabel ? ` · 开启于 ${createdLabel}` : ""}</span>
                </div>
                <p className="settings-card-hint">密码不会再次显示。需要换密码时先关闭再重新开启；关闭与更换都要验证当前密码。</p>
                <div className="app-lock-actions">
                  <button type="button" className="secondary-setting" onClick={() => openDisable("change")}><KeyRound size={14} />更换密码</button>
                  <button type="button" className="secondary-setting" onClick={() => openDisable("off")}><Lock size={14} />关闭应用锁</button>
                  <button type="button" className="primary-setting" onClick={lockNow}><Lock size={14} />立即锁定</button>
                </div>
              </>
            ) : (
              <>
                <p className="settings-card-hint">开启后生成一个解锁密码（随机或自定义）。密码<strong>只展示一次</strong>，请务必抄下并备份；连续输错 10 次会清空应用数据并重置。</p>
                <div className="app-lock-actions">
                  <button type="button" className="primary-setting" onClick={openEnable}><Sparkles size={14} />开启应用锁</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <SettingsGroupHead title="规则与边界" hint="开启前先看清楚" />
      <div className="settings-exp-card">
        <div className="settings-card app-lock-rules">
          <ul>
            <li><b>只展示一次</b><span>随机密码和自定义密码都只在开启流程里显示一次，关闭后无法再次查看。</span></li>
            <li><b>10 次错误 = 重置</b><span>失败次数会落盘，重启应用也累计；第 10 次错误会清空应用数据（会话、配置、密钥、记忆、技能等）并重启，不可撤销。</span></li>
            <li><b>忘记密码无法找回</b><span>没有备用密码、没有管理员通道；只能按上面的重置规则处理，请务必先备份密码。</span></li>
            <li><b>这是界面门禁，不是磁盘加密</b><span>它能阻止别人在运行中的应用里操作；能直接读取本机文件的人仍可绕过，不要把重要数据只寄托在它上面。</span></li>
            <li><b>重新显示会再锁</b><span>窗口隐藏/最小化超过 30 秒再回来需要重新输入；点「立即锁定」可马上回到锁屏。</span></li>
          </ul>
        </div>
      </div>

      {setupOpen && createPortal(
        <div className="app-lock-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !setupBusy && !prepared) closeSetup(); }}>
          <div className="app-lock-modal" role="dialog" aria-modal="true" aria-label={prepared ? "保存解锁密码" : "开启应用锁"}>
            <header>
              <div><Lock size={16} /><strong>{prepared ? "保存解锁密码" : "开启应用锁"}</strong></div>
              <button type="button" className="app-lock-modal-close" title={prepared ? "取消，不开启" : "关闭"} disabled={setupBusy} onClick={closeSetup}><X size={15} /></button>
            </header>
            {prepared ? (
              <div className="app-lock-modal-body">
                <div className="app-lock-onetime-warning"><ShieldAlert size={16} /><div><b>密码只显示这一次</b><span>关闭后无法再次查看。请现在抄下或复制到安全的地方。</span></div></div>
                <div className="app-lock-password-box">
                  <code>{displayPassword(prepared.password, prepared.kind)}</code>
                  <button type="button" className="secondary-setting" onClick={() => void copyPassword()}>{copied ? <><Check size={13} />已复制</> : <><Copy size={13} />复制</>}</button>
                </div>
                {prepared.kind === "random" ? <p className="app-lock-modal-hint">空格只为方便阅读，输入时不用打空格。</p> : null}
                <label className="app-lock-ack">
                  <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />
                  <span>我已抄下并妥善备份这个密码，知道忘记后只能通过 10 次错误重置。</span>
                </label>
                {setupError ? <div className="app-lock-error">{setupError}</div> : null}
                <div className="app-lock-modal-actions">
                  <button type="button" className="secondary-setting" disabled={setupBusy} onClick={closeSetup}>取消，不开启</button>
                  <button type="button" className="primary-setting" disabled={!ack || setupBusy} onClick={() => void commit()}>{setupBusy ? <><LoaderCircle size={14} className="spin" />开启中…</> : "完成并开启"}</button>
                </div>
              </div>
            ) : (
              <div className="app-lock-modal-body">
                <div className="perm-seg app-lock-mode-seg">
                  <button type="button" className={mode === "random" ? "on" : ""} onClick={() => setMode("random")}><strong>随机密码</strong><small>生成 16 位随机密码，最省心</small></button>
                  <button type="button" className={mode === "custom" ? "on" : ""} onClick={() => setMode("custom")}><strong>自定义密码</strong><small>自己设，至少 6 位</small></button>
                </div>
                {mode === "custom" ? (
                  <>
                    <label className="app-lock-field"><span>设置密码</span><input type="password" autoComplete="new-password" value={custom1} onChange={(event) => setCustom1(event.target.value)} placeholder="至少 6 位" /></label>
                    <label className="app-lock-field"><span>再输一次</span><input type="password" autoComplete="new-password" value={custom2} onChange={(event) => setCustom2(event.target.value)} placeholder="与上面一致" /></label>
                  </>
                ) : (
                  <p className="app-lock-modal-hint">点「生成密码」后会把 16 位随机密码显示一次，请当场复制或抄下。</p>
                )}
                <div className="app-lock-onetime-warning"><ShieldAlert size={16} /><div><b>务必记住并备份</b><span>密码只展示一次；连续输错 10 次会清空应用数据并重置，无法恢复。</span></div></div>
                {setupError ? <div className="app-lock-error">{setupError}</div> : null}
                <div className="app-lock-modal-actions">
                  <button type="button" className="secondary-setting" disabled={setupBusy} onClick={closeSetup}>取消</button>
                  <button type="button" className="primary-setting" disabled={setupBusy} onClick={() => void prepare()}>{setupBusy ? <><LoaderCircle size={14} className="spin" />生成中…</> : "生成密码"}</button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}

      {disableOpen && createPortal(
        <div className="app-lock-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !disableBusy) closeDisable(); }}>
          <div className="app-lock-modal" role="dialog" aria-modal="true" aria-label={disableIntent === "change" ? "更换密码" : "关闭应用锁"}>
            <header>
              <div><Lock size={16} /><strong>{disableIntent === "change" ? "更换密码" : "关闭应用锁"}</strong></div>
              <button type="button" className="app-lock-modal-close" title="关闭" disabled={disableBusy} onClick={closeDisable}><X size={15} /></button>
            </header>
            <div className="app-lock-modal-body">
              {disableReset ? (
                <div className="app-lock-resetting"><LoaderCircle size={18} className="spin" />已连续输错 10 次，正在清空应用数据并重启…</div>
              ) : (
                <>
                  <p className="app-lock-modal-hint">先验证当前密码。{disableIntent === "change" ? "验证后会重新生成一个新密码。" : "关闭后下次启动不再要求解锁。"}</p>
                  <label className="app-lock-field"><span>当前密码</span><input type="password" autoComplete="off" autoFocus value={disablePassword} onChange={(event) => setDisablePassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitDisable(); } }} placeholder="输入当前解锁密码" /></label>
                  {disableError ? <div className="app-lock-error">{disableError}</div> : null}
                  <div className="app-lock-onetime-warning"><ShieldAlert size={16} /><div><b>输错同样计数</b><span>这里输错也会累计，达到 10 次会清空应用数据并重置。</span></div></div>
                  <div className="app-lock-modal-actions">
                    <button type="button" className="secondary-setting" disabled={disableBusy} onClick={closeDisable}>取消</button>
                    <button type="button" className="primary-setting" disabled={disableBusy || !disablePassword.trim()} onClick={() => void submitDisable()}>{disableBusy ? <><LoaderCircle size={14} className="spin" />验证中…</> : disableIntent === "change" ? "验证并更换" : "关闭应用锁"}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
