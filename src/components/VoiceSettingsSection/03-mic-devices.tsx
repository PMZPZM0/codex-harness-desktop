/**
 * VoiceSettingsSectionMicDevices —— VoiceSettingsSection 的 JSX 第 3 段（09-22 从 VoiceSettingsSection.tsx 分出，纯搬迁）。
 * ⛔ props 类型由 TypeChecker 从**原作用域**推断（不是 any）⇒ 静态检查强度不降。
 */
import { Trash2, Upload, Headphones, Keyboard, Mic, Play, Radio, ShieldAlert, Sparkles, Square, Zap } from "lucide-react";
import { Settings } from "../VoiceSettingsSection";

type Props = {
  apply: (patch: Partial<import("../VoiceSettingsSection.tsx").Settings>) => void;
  micLevel: number;
  micTesting: boolean;
  mics: { deviceId: string; label: string; }[];
  saving: boolean;
  settings: Settings;
  toggleMicTest: () => Promise<void>;
};

export function VoiceSettingsSectionMicDevices({ apply, micLevel, micTesting, mics, saving, settings, toggleMicTest }: Props) {
  return (
    <div className="voice-card">
            <div className="voice-card-head"><Mic size={15} /><span>麦克风</span></div>
            <div className="voice-card-body">
              <select
                className="voice-input"
                value={settings.mic.deviceId}
                onChange={(e) => apply({ mic: { ...settings.mic, deviceId: e.target.value } })}
                disabled={saving}
              >
                <option value="">系统默认设备</option>
                {mics.map((m) => (
                  <option key={m.deviceId} value={m.deviceId}>{m.label}</option>
                ))}
                {!mics.length && <option value="" disabled>（未检测到麦克风设备）</option>}
              </select>
              <div className="voice-row">
                <button className="secondary-setting" onClick={() => void toggleMicTest()}>
                  {micTesting ? <Square size={13} /> : <Mic size={13} />}{micTesting ? "停止测试" : "测试麦克风"}
                </button>
                {micTesting && (
                  <div className="voice-level" title="对着麦克风说话，条会动说明拾音正常">
                    <span style={{ width: `${Math.round(micLevel * 100)}%` }} />
                  </div>
                )}
              </div>
              <div className="voice-card-hint">
                {!mics.length
                  ? "未检测到任何麦克风输入设备——本机的语音通话 / 语音输入用不了（不影响渠道语音消息转写，那不需要本机麦克风）。请检查设备是否接好、是否被禁用。"
                  : micTesting ? "对着麦克风说话——上面的电平条会跳动，说明这个设备能正常拾音。" : "选不到想要的麦克风？先在别的程序里禁用/拔掉多余的，或点「测试麦克风」确认拾音。"}
              </div>
              <div className="voice-toggles">
                <label className="voice-toggle">
                  <input
                    type="checkbox"
                    checked={settings.mic.echoCancellation}
                    onChange={(e) => apply({ mic: { ...settings.mic, echoCancellation: e.target.checked } })}
                    disabled={saving}
                  />
                  <span>回声消除（外放时建议开）</span>
                </label>
                <label className="voice-toggle">
                  <input
                    type="checkbox"
                    checked={settings.mic.noiseSuppression}
                    onChange={(e) => apply({ mic: { ...settings.mic, noiseSuppression: e.target.checked } })}
                    disabled={saving}
                  />
                  <span>噪声抑制（环境吵时开，可能压低人声）</span>
                </label>
                <label className="voice-toggle">
                  <input
                    type="checkbox"
                    checked={settings.mic.autoGainControl}
                    onChange={(e) => apply({ mic: { ...settings.mic, autoGainControl: e.target.checked } })}
                    disabled={saving}
                  />
                  <span>自动增益（离麦远时开，会放大底噪）</span>
                </label>
              </div>
            </div>
          </div>
  );
}
