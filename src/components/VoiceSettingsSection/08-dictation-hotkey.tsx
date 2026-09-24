/**
 * VoiceSettingsSectionDictationHotkey —— VoiceSettingsSection 的 JSX 第 8 段（09-22 从 VoiceSettingsSection.tsx 分出，纯搬迁）。
 * ⛔ props 类型由 TypeChecker 从**原作用域**推断（不是 any）⇒ 静态检查强度不降。
 */
import { Trash2, Upload, Headphones, Keyboard, Mic, Play, Radio, ShieldAlert, Sparkles, Square, Zap } from "lucide-react";
import { showHotkey, Settings } from "../VoiceSettingsSection";

type Props = {
  apply: (patch: Partial<import("../VoiceSettingsSection.tsx").Settings>) => void;
  captureHotkey: (kind?: "call" | "dictation") => void;
  capturing: "call" | "dictation" | null;
  saving: boolean;
  settings: Settings;
};

export function VoiceSettingsSectionDictationHotkey({ apply, captureHotkey, capturing, saving, settings }: Props) {
  return (
    <div className="voice-card">
            <div className="voice-card-head"><Mic size={15} /><span>长按语音输入</span></div>
            <div className="voice-card-body">
              <div className="voice-row">
                <button className="secondary-setting" onClick={() => captureHotkey("dictation")} disabled={Boolean(capturing)}>
                  {capturing === "dictation" ? "请按下组合键…（Esc 取消）" : "录入长按快捷键"}
                </button>
                <code className="voice-kbd">{showHotkey(settings.dictationHotkey.accelerator) || "未设置"}</code>
                <label className="voice-toggle">
                  <input
                    type="checkbox"
                    checked={settings.dictationHotkey.enabled}
                    onChange={(e) => apply({ dictationHotkey: { enabled: e.target.checked, accelerator: settings.dictationHotkey.accelerator } })}
                    disabled={saving}
                  />
                  <span>启用</span>
                </label>
              </div>
              <div className="voice-card-hint">
                在应用内<strong>按住</strong>快捷键开始语音输入，松开即结束；识别出的中文字幕会放进输入框，确认后再点发送。默认 Alt + Space。
              </div>
            </div>
          </div>
  );
}
