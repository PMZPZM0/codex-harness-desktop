/**
 * VoiceSettingsSectionVoicePicker —— VoiceSettingsSection 的 JSX 第 1 段（09-22 从 VoiceSettingsSection.tsx 分出，纯搬迁）。
 * ⛔ props 类型由 TypeChecker 从**原作用域**推断（不是 any）⇒ 静态检查强度不降。
 */
import { Trash2, Upload, Headphones, Keyboard, Mic, Play, Radio, ShieldAlert, Sparkles, Square, Zap } from "lucide-react";
import { Settings } from "../VoiceSettingsSection";

type Props = {
  apply: (patch: Partial<import("../VoiceSettingsSection.tsx").Settings>) => void;
  audition: () => Promise<void>;
  auditionPhase: "idle" | "synth" | "playing";
  saving: boolean;
  settings: Settings;
  voiceOptions: { value: number; label: string; }[];
};

export function VoiceSettingsSectionVoicePicker({ apply, audition, auditionPhase, saving, settings, voiceOptions }: Props) {
  return (
    <div className="voice-card">
            <div className="voice-card-head"><Headphones size={15} /><span>音色</span></div>
            <div className="voice-card-body">
              <div className="voice-row">
                <select
                  className="voice-input"
                  value={settings.tts.sid}
                  onChange={(e) => apply({ tts: { ...settings.tts, sid: Number(e.target.value) } })}
                  disabled={saving}
                >
                  {voiceOptions.map((v) => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
                <button className="secondary-setting voice-audition" onClick={() => void audition()} disabled={auditionPhase === "synth" || saving}>
                  {auditionPhase === "synth" ? <><Square size={13} />合成中…</> : auditionPhase === "playing" ? <><Square size={13} />停止</> : <><Play size={13} />试听</>}
                </button>
              </div>
              <div className="voice-card-hint">
                点「试听」用当前音色和语速念一句示例话（首次要加载模型，稍等；之后再点就是秒出）。播放中再点一次即停止。
              </div>
            </div>
          </div>
  );
}
