/**
 * VoiceSettingsSectionBargeMode —— VoiceSettingsSection 的 JSX 第 5 段（09-22 从 VoiceSettingsSection.tsx 分出，纯搬迁）。
 * ⛔ props 类型由 TypeChecker 从**原作用域**推断（不是 any）⇒ 静态检查强度不降。
 */
import { Settings } from "../VoiceSettingsSection";

type Props = {
  apply: (patch: Partial<import("../VoiceSettingsSection.tsx").Settings>) => void;
  saving: boolean;
  settings: Settings;
};

export function VoiceSettingsSectionBargeMode({ apply, saving, settings }: Props) {
  return (
    <div className="voice-card">
            <div className="voice-card-head"><span>打断方式</span></div>
            <div className="voice-card-body voice-card-body-row">
              <label className={`voice-radio ${settings.barge.mode === "auto" ? "active" : ""}`}>
                <input
                  type="radio"
                  name="bargeMode"
                  value="auto"
                  checked={settings.barge.mode === "auto"}
                  onChange={() => apply({ barge: { gateDb: settings.barge.gateDb, mode: "auto" } })}
                  disabled={saving}
                />
                <div className="voice-radio-body">
                  <strong>自动</strong>
                  <span>耳机 / 安静环境推荐；播报时检测到真人插话即停 TTS + turn/interrupt。</span>
                </div>
              </label>
              <label className={`voice-radio ${settings.barge.mode === "manual" ? "active" : ""}`}>
                <input
                  type="radio"
                  name="bargeMode"
                  value="manual"
                  checked={settings.barge.mode === "manual"}
                  onChange={() => apply({ barge: { gateDb: settings.barge.gateDb, mode: "manual" } })}
                  disabled={saving}
                />
                <div className="voice-radio-body">
                  <strong>手动</strong>
                  <span>外放推荐，避开回声误触；只有按「打断」按钮才停 TTS。</span>
                </div>
              </label>
            </div>
          </div>
  );
}
