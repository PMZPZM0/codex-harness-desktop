/**
 * VoiceSettingsSectionFloatingBall —— VoiceSettingsSection 的 JSX 第 6 段（09-22 从 VoiceSettingsSection.tsx 分出，纯搬迁）。
 * ⛔ props 类型由 TypeChecker 从**原作用域**推断（不是 any）⇒ 静态检查强度不降。
 */
import { Trash2, Upload, Headphones, Keyboard, Mic, Play, Radio, ShieldAlert, Sparkles, Square, Zap } from "lucide-react";
import { Settings } from "../VoiceSettingsSection";

type Props = {
  apply: (patch: Partial<import("../VoiceSettingsSection.tsx").Settings>) => void;
  saving: boolean;
  settings: Settings;
};

export function VoiceSettingsSectionFloatingBall({ apply, saving, settings }: Props) {
  return (
    <div className="voice-card">
            <div className="voice-card-head"><Sparkles size={15} /><span>悬浮球</span></div>
            <div className="voice-card-body">
              <div className="voice-toggles">
                <label className="voice-toggle">
                  <input
                    type="checkbox"
                    checked={settings.ball.visible}
                    onChange={(e) => apply({ ball: { visible: e.target.checked, hints: settings.ball.hints } })}
                    disabled={saving}
                  />
                  <span>显示悬浮球</span>
                </label>
                <label className="voice-toggle">
                  <input
                    type="checkbox"
                    checked={settings.ball.hints}
                    onChange={(e) => apply({ ball: { visible: settings.ball.visible, hints: e.target.checked } })}
                    disabled={saving}
                  />
                  <span>冒随机的短提示气泡</span>
                </label>
              </div>
              <div className="voice-card-hint">
                关掉显示后，可以回到这里重新打开；悬浮球上<strong>右键</strong>也能直接隐藏或跳到本页。
              </div>
            </div>
          </div>
  );
}
