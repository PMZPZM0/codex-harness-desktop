/**
 * 设置页 · 截图（09-24）。
 *
 * 用户需求：「带快捷键的截图功能；快捷键要在设置里自定义绑定，并适配 Windows 和 macOS」。
 * ⛔ 输入框**不加截图图标按钮**（用户明确：「截图在输入框里面预提醒就行了，图标就不用加了」）——
 *    截图入口只有快捷键 + 这一页的「试试截图」，结果统一落到输入框（见 app-state 的
 *    `onScreenshotCaptured` 订阅）。
 *
 * 两种模式各自一条全局快捷键：
 *   · 全屏 —— 隐藏窗口后截整块屏幕；
 *   · 框选 —— 隐藏窗口 → 冻结画面 → 拖框选区。
 *
 * ⛔ 注册失败**照实显示**（`snapshot.errors`）：全局快捷键是系统级抢占，被别的程序占用时
 *    静默失败会让用户以为「功能坏了」。也正因此，改键一律「先注册成功才落盘」。
 */
import { useCallback, useEffect, useState } from "react";
import { Camera, Check, Crop, FolderOpen, Keyboard, RotateCcw, TriangleAlert, X } from "lucide-react";
import { hk } from "../../lib/hk";
import { isMacPlatform } from "../../lib/is-mac-platform";

export type ScreenshotSettingsSectionProps = { onNotice?: (message: string) => void };

/** Electron accelerator → 界面显示：Windows 把 CommandOrControl 写成 Ctrl，mac 交给 hk() 出符号。 */
function hotkeyText(accelerator: string): string {
  const raw = String(accelerator ?? "");
  if (!raw) return "";
  const windowsStyle = raw
    .replace(/CommandOrControl/gi, "Ctrl")
    .replace(/\bCommand\b/gi, "Win")
    .replace(/\bSuper\b/gi, "Win");
  return hk(windowsStyle);
}

const MODE_LABEL: Record<ShotMode, string> = { full: "全屏截图", region: "框选截图" };
const MODE_DESC: Record<ShotMode, string> = {
  full: "隐藏窗口后截取整块屏幕，图片自动放进输入框",
  region: "隐藏窗口后拖框选择区域，只截选中的部分",
};

export function ScreenshotSettingsSection({ onNotice }: ScreenshotSettingsSectionProps) {
  const [snapshot, setSnapshot] = useState<ScreenshotSettingsSnapshot | null>(null);
  const [capturing, setCapturing] = useState<ShotMode | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await window.codex.screenshotSettingsGet());
    } catch (error: any) {
      onNotice?.(`读取截图设置失败：${error?.message ?? error}`);
    }
  }, [onNotice]);

  useEffect(() => { void refresh(); }, [refresh]);

  /** 录入快捷键：按住组合键 → 翻译成 Electron accelerator。
   *  与语音设置页同一套口径（⌘ 在 mac 记 Command、Windows 记 Super；至少一个修饰键；
   *  主键优先用 e.code 物理键位 —— 用 e.key 会把 Ctrl+Shift+1 的「!」丢掉）。 */
  const captureHotkey = useCallback((mode: ShotMode) => {
    setCapturing(mode);
    const cleanup = () => {
      setCapturing(null);
      window.removeEventListener("keydown", onKey, true);
    };
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") { cleanup(); return; }
      const mods: string[] = [];
      if (event.ctrlKey) mods.push("Ctrl");
      if (event.metaKey) mods.push(isMacPlatform() ? "Command" : "Super");
      if (event.shiftKey) mods.push("Shift");
      if (event.altKey) mods.push("Alt");
      if (!mods.length) return;
      const code = event.code ?? "";
      const letter = code.match(/^Key([A-Z])$/)?.[1];
      const digit = code.match(/^Digit([0-9])$/)?.[1];
      const fkey = code.match(/^F([1-9]|1[0-2])$/)?.[0];
      let main = letter ?? digit ?? fkey ?? "";
      if (!main && code === "Space") main = "Space";
      if (!main && /^[A-Z0-9]$/.test(event.key)) main = event.key;
      if (!main) {
        onNotice?.("这个键不能做快捷键（支持：字母 / 数字 / F1~F12 / Space，且至少带一个修饰键）");
        return;
      }
      const accelerator = [...mods, main].join("+");
      cleanup();
      void window.codex.screenshotHotkeySet({ mode, accelerator, enabled: true }).then(async (result) => {
        if (!result?.ok) {
          onNotice?.(`快捷键「${accelerator}」注册失败，已保留原设置：${result?.error ?? "可能被其它程序占用"}`);
        }
        await refresh();
      });
    };
    window.addEventListener("keydown", onKey, true);
  }, [onNotice, refresh]);

  async function patch(next: Partial<ScreenshotSettings>) {
    setBusy(true);
    try {
      const result = await window.codex.screenshotSettingsSet(next);
      setSnapshot((current) => (current ? { ...current, ...result } : current));
    } catch (error: any) {
      onNotice?.(`保存失败：${error?.message ?? error}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleMode(mode: ShotMode, enabled: boolean) {
    const accelerator = snapshot?.settings[mode].accelerator ?? "";
    if (enabled && !accelerator) { captureHotkey(mode); return; }
    const result = await window.codex.screenshotHotkeySet({ mode, accelerator, enabled });
    if (!result?.ok && result?.error) onNotice?.(result.error);
    await refresh();
  }

  async function captureNow(mode: ShotMode) {
    setBusy(true);
    try {
      const result = await window.codex.screenshotCapture(mode);
      if (!result.ok) {
        if (result.canceled) onNotice?.("已取消截图");
        else onNotice?.(`截图失败：${result.error ?? "未知原因"}`);
        return;
      }
      // 成功路径：主进程已推 screenshot:captured ⇒ 图已在输入框里，这里只补一句说明
      onNotice?.(`截图完成（${result.width}×${result.height}），已放进输入框`);
    } catch (error: any) {
      onNotice?.(`截图失败：${error?.message ?? error}`);
    } finally {
      setBusy(false);
    }
  }

  async function pickDir() {
    const dir = await window.codex.screenshotPickDir();
    if (!dir) return;
    await patch({ saveDir: dir });
    onNotice?.(`截图将保存到：${dir}`);
  }

  if (!snapshot) return <section className="settings-section stack screenshot-settings"><p className="muted">正在读取截图设置…</p></section>;
  const isMac = snapshot.platform === "darwin";
  const saveDir = snapshot.settings.saveDir || snapshot.defaultDir;

  return (
    <section className="settings-section stack screenshot-settings">
      <header className="settings-block-head">
        <Camera size={16} />
        <div>
          <h3>截图</h3>
          <p className="muted">按快捷键随时截图，图片会自动放进输入框（不会自动发送）。</p>
        </div>
      </header>

      {isMac && (
        <p className="shot-warn">
          <TriangleAlert size={13} />
          macOS 首次截图需要授权：系统设置 → 隐私与安全性 → <b>屏幕录制</b>，勾选本应用后重启应用。
        </p>
      )}

      <section className="shot-card">
        <h4><Keyboard size={14} />快捷键</h4>
        {(["full", "region"] as ShotMode[]).map((mode) => {
          const slot = snapshot.settings[mode];
          const registered = snapshot.registered[mode];
          const error = snapshot.errors[mode];
          return (
            <div className="shot-hotkey-row" key={mode}>
              <div className="shot-hotkey-info">
                <strong>{mode === "full" ? <Camera size={13} /> : <Crop size={13} />}{MODE_LABEL[mode]}</strong>
                <small>{MODE_DESC[mode]}</small>
                {error && <em className="shot-error"><TriangleAlert size={11} />{error}</em>}
                {!error && slot.enabled && !registered && <em className="shot-error"><TriangleAlert size={11} />快捷键尚未挂上（可能还没生效，改一次键即可重试）</em>}
              </div>
              <div className="shot-hotkey-control">
                <button
                  type="button"
                  className={`shot-kbd ${capturing === mode ? "recording" : ""}`}
                  title="点击后按下新组合键（Esc 取消）"
                  onClick={() => captureHotkey(mode)}
                >
                  {capturing === mode ? "请按组合键…" : (hotkeyText(slot.accelerator) || "未设置")}
                </button>
                <label className="shot-switch" title={slot.enabled ? "停用这条快捷键" : "启用这条快捷键"}>
                  <input type="checkbox" checked={slot.enabled} onChange={(event) => void toggleMode(mode, event.target.checked)} />
                  <span>启用</span>
                </label>
                <button
                  type="button"
                  className="shot-reset"
                  title="恢复默认快捷键"
                  onClick={() => void window.codex.screenshotHotkeySet({ mode, accelerator: snapshot.defaults[mode].accelerator, enabled: snapshot.defaults[mode].enabled }).then(async (result) => {
                    if (!result?.ok) onNotice?.(result?.error ?? "恢复默认失败");
                    await refresh();
                  })}
                ><RotateCcw size={12} /></button>
              </div>
            </div>
          );
        })}
        <p className="muted shot-tip">
          两条快捷键不能相同；Windows 记 <code>Ctrl+Shift+Alt+A</code> 这类写法，macOS 会自动显示成 <code>⌘⇧⌥A</code>。
          默认都没占用浏览器常用组合（<code>Ctrl+Shift+S</code> 是「另存为」、<code>Ctrl+Shift+A</code> 是「搜索标签页」）。
        </p>
      </section>

      <section className="shot-card">
        <h4><FolderOpen size={14} />截图行为</h4>
        <label className="shot-line">
          <input type="checkbox" checked={snapshot.settings.hideWindow} disabled={busy} onChange={(event) => void patch({ hideWindow: event.target.checked })} />
          <span>截图前隐藏本应用窗口<small>勾选 = 只截屏幕上的其它内容（「隐藏窗口截图」）；取消 = 把本应用一起截进去</small></span>
        </label>
        <div className="shot-line shot-dir">
          <span>保存目录<small>{saveDir}</small></span>
          <div>
            <button type="button" onClick={() => void pickDir()}>选择…</button>
            <button type="button" onClick={() => void window.codex.screenshotReveal(saveDir)}>打开</button>
            {snapshot.settings.saveDir && <button type="button" onClick={() => void patch({ saveDir: "" })}>用默认</button>}
          </div>
        </div>
      </section>

      <section className="shot-card">
        <h4><Check size={14} />试试截图</h4>
        <div className="shot-test-row">
          <button type="button" disabled={busy} onClick={() => void captureNow("full")}><Camera size={13} />全屏截图</button>
          <button type="button" disabled={busy} onClick={() => void captureNow("region")}><Crop size={13} />框选截图</button>
          <span className="muted">按快捷键与点这里效果一样；截图会先弹出编辑器（可标注），确认后复制到剪贴板并放进输入框。</span>
        </div>
      </section>

      {busy && <p className="muted"><X size={11} /> 正在处理…</p>}
    </section>
  );
}
