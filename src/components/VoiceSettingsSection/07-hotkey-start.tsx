/**
 * VoiceSettingsSectionHotkeyStart —— VoiceSettingsSection 的 JSX 第 7 段（09-22 从 VoiceSettingsSection.tsx 分出，纯搬迁）。
 * ⛔ props 类型由 TypeChecker 从**原作用域**推断（不是 any）⇒ 静态检查强度不降。
 */
import { Trash2, Upload, Headphones, Keyboard, Mic, Play, Radio, ShieldAlert, Sparkles, Square, Zap } from "lucide-react";
import { IS_MAC_UI, showHotkey, Settings } from "../VoiceSettingsSection";

type Props = {
  apply: (patch: Partial<import("../VoiceSettingsSection.tsx").Settings>) => void;
  captureHotkey: (kind?: "call" | "dictation") => void;
  capturing: "call" | "dictation" | null;
  onNotice: (m: string) => void;
  saving: boolean;
  settings: Settings;
};

export function VoiceSettingsSectionHotkeyStart({ apply, captureHotkey, capturing, onNotice, saving, settings }: Props) {
  return (
    <div className="voice-card">
            <div className="voice-card-head"><Keyboard size={15} /><span>按键启动</span></div>
            <div className="voice-card-body">
              <div className="voice-row">
                <button className="secondary-setting" onClick={() => captureHotkey("call")} disabled={Boolean(capturing)}>
                  {capturing === "call" ? "请按下组合键…（Esc 取消）" : "录入快捷键"}
                </button>
                <code className="voice-kbd">{showHotkey(settings.hotkey.accelerator) || "未设置"}</code>
                <label className="voice-toggle">
                  <input
                    type="checkbox"
                    checked={settings.hotkey.enabled}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      // 与录入一致：注册/注销成功才落盘，失败保留原状态并提示
                      void window.codex.voiceHotkeySet({ accelerator: settings.hotkey.accelerator, enabled }).then((r: any) => {
                        if (!r?.ok) {
                          onNotice(`快捷键${enabled ? "注册" : "注销"}失败：${r?.error ?? "可能被其它程序占用"}`);
                          return;
                        }
                        apply({ hotkey: { enabled, accelerator: settings.hotkey.accelerator } });
                      });
                    }}
                    disabled={saving}
                  />
                  <span>启用（应用没聚焦也能唤起）</span>
                </label>
              </div>
              <div className="voice-card-hint">
                系统级快捷键，按一下开始、再按一下结束。需要至少带一个修饰键（{IS_MAC_UI ? "⌘ / ⇧ / ⌥" : "Ctrl / Shift / Alt"}），避免吞掉正常输入。
              </div>
            </div>
          </div>
  );
}
