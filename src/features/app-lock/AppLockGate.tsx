/**
 * 应用锁门禁（10-26）：在 `<App/>` 挂载**之前**查主进程状态。
 *  - 未开启：直接渲染 App；
 *  - 已开启：只渲染锁屏，App 不挂载 ⇒ 侧栏/会话/本地状态都不会先加载出来；
 *  - 窗口隐藏超过 30 秒再回来：重新上锁（App 卸载，键盘快捷键也一起失效）。
 *
 * ⛔ 状态查询失败时**失败关闭**（显示重试页，不渲染 App）—— 否则一次 IPC 故障就绕过了锁。
 * ⛔ 解锁成功后给 BootIntroGate 留一个一次性标记：否则用户刚输完密码还要看十几秒开机动画。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { KeyRound, LoaderCircle, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";

type LockStatus = Awaited<ReturnType<typeof window.codex.appLockStatus>>;
const RELOCK_AFTER_HIDDEN_MS = 30_000;

export function AppLockGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [resetting, setResetting] = useState(false);
  const hiddenAtRef = useRef(0);

  const load = useCallback(async () => {
    setChecking(true);
    setError("");
    try {
      const next = await window.codex.appLockStatus();
      setStatus(next);
      setUnlocked(!next.enabled);
      setResetting(Boolean(next.enabled && next.resetRequired));
    } catch (err: any) {
      setError(String(err?.message ?? err ?? "读取应用锁状态失败"));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!status?.enabled) return;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = 0;
      if (hiddenAt && Date.now() - hiddenAt >= RELOCK_AFTER_HIDDEN_MS) setUnlocked(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [status?.enabled]);

  if (checking) {
    return (
      <div className="app-lock-screen" role="status" aria-live="polite">
        <div className="app-lock-card app-lock-card-center">
          <span className="app-lock-emblem"><KeyRound size={22} /></span>
          <h2>正在检查应用锁</h2>
          <LoaderCircle size={18} className="spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-lock-screen" role="alert">
        <div className="app-lock-card app-lock-card-center">
          <span className="app-lock-emblem is-warn"><ShieldAlert size={22} /></span>
          <h2>无法读取应用锁状态</h2>
          <p>为了安全，暂时不加载应用内容。请重试。</p>
          <code className="app-lock-inline-error">{error}</code>
          <button type="button" className="app-lock-primary" onClick={() => void load()}><RefreshCw size={14} />重试</button>
        </div>
      </div>
    );
  }

  if (status?.enabled && !unlocked) {
    return (
      <AppLockScreen
        resetting={resetting || Boolean(status.resetRequired)}
        onReset={() => setResetting(true)}
        onUnlocked={() => {
          try { sessionStorage.setItem("app-lock-skip-boot", "1"); } catch { /* 忽略 */ }
          setUnlocked(true);
        }}
      />
    );
  }

  return <>{children}</>;
}

function AppLockScreen({ resetting, onReset, onUnlocked }: { resetting: boolean; onReset: () => void; onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!resetting) inputRef.current?.focus(); }, [resetting]);

  const submit = async () => {
    if (busy || resetting) return;
    const value = password;
    if (!value.trim()) { setError("请输入解锁密码"); return; }
    setBusy(true);
    setError("");
    try {
      const result = await window.codex.appLockVerify(value);
      if (result.ok) {
        setPassword("");
        onUnlocked();
        return;
      }
      if (result.reset) {
        setPassword("");
        onReset();
        return;
      }
      setError(`密码错误，还可尝试 ${result.remaining} 次`);
      setPassword("");
      inputRef.current?.focus();
    } catch (err: any) {
      setError(String(err?.message ?? err ?? "验证失败，请重试"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-lock-screen" role="dialog" aria-modal="true" aria-label="应用已上锁">
      <div className="app-lock-card">
        <span className="app-lock-emblem"><ShieldCheck size={22} /></span>
        <h2>{resetting ? "正在重置应用" : "应用已上锁"}</h2>
        <p>{resetting ? "已连续输错 10 次，正在清空应用数据并重启，请不要关闭窗口。" : "输入解锁密码继续。密码只在开启时展示过一次。"}</p>
        {resetting ? (
          <div className="app-lock-resetting"><LoaderCircle size={18} className="spin" />正在清空并重启…</div>
        ) : (
          <>
            <input
              ref={inputRef}
              type="password"
              className="app-lock-input"
              placeholder="解锁密码"
              autoComplete="off"
              spellCheck={false}
              value={password}
              onChange={(event) => { setPassword(event.target.value); if (error) setError(""); }}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submit(); } }}
              disabled={busy}
            />
            {error ? <div className="app-lock-error" role="alert">{error}</div> : null}
            <button type="button" className="app-lock-primary" onClick={() => void submit()} disabled={busy || !password.trim()}>
              {busy ? <><LoaderCircle size={14} className="spin" />验证中…</> : "解锁"}
            </button>
            <p className="app-lock-foot">忘记密码没有其他找回方式：连续输错 10 次会清空应用数据并重置。</p>
          </>
        )}
      </div>
    </div>
  );
}
