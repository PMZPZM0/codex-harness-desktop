/**
 * VoiceSettingsSectionEndpointWait —— VoiceSettingsSection 的 JSX 第 4 段（09-22 从 VoiceSettingsSection.tsx 分出，纯搬迁）。
 * ⛔ props 类型由 TypeChecker 从**原作用域**推断（不是 any）⇒ 静态检查强度不降。
 */
import { Settings } from "../VoiceSettingsSection";

type Props = {
  apply: (patch: Partial<import("../VoiceSettingsSection.tsx").Settings>) => void;
  saving: boolean;
  settings: Settings;
};

export function VoiceSettingsSectionEndpointWait({ apply, saving, settings }: Props) {
  return (
    <div className="voice-card">
            <div className="voice-card-head">
              <span>断句等待</span>
              <span className="voice-card-value">{settings.asr.rule1.toFixed(1)} 秒</span>
            </div>
            <div className="voice-card-body">
              <input
                className="voice-range"
                type="range"
                min={0.4}
                max={6.0}
                step={0.1}
                value={settings.asr.rule1}
                onChange={(e) => apply({ asr: { ...settings.asr, rule1: Number(e.target.value) } })}
                disabled={saving}
              />
              <div className="voice-card-hint">
                说完停多久算「这句说完了」。<strong>调小反应更快</strong>（0.4~1.2 秒），但容易被自己的停顿截断；调大更稳但等得久。
              </div>
            </div>
          </div>
  );
}
