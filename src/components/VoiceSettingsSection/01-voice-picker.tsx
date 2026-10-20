/**
 * VoiceSettingsSectionVoicePicker —— VoiceSettingsSection 的 JSX 第 1 段（09-22 从 VoiceSettingsSection.tsx 分出，纯搬迁）。
 * ⛔ props 类型由 TypeChecker 从**原作用域**推断（不是 any）⇒ 静态检查强度不降。
 */
import { Trash2, Upload, Headphones, Keyboard, Mic, Play, Radio, ShieldAlert, Sparkles, Square, Zap } from "lucide-react";
import { AppSelect } from "../AppSelect";
import { Settings } from "../VoiceSettingsSection";

type Props = {
  apply: (patch: Partial<import("../VoiceSettingsSection.tsx").Settings>) => void;
  audition: () => Promise<void>;
  auditionPhase: "idle" | "synth" | "playing";
  saving: boolean;
  settings: Settings;
  voiceOptions: { value: number; label: string; }[];
  /** 当前选中的「我的音色」名称（空 = 用基础音色）——顶部必须显示它，
   *  否则选中克隆音色后下拉还停在「音色 3」，用户会以为没切换（10-21 报障）。 */
  activeProfileName?: string;
  zipReady: boolean;
};

export function VoiceSettingsSectionVoicePicker({ apply, audition, auditionPhase, saving, settings, voiceOptions, activeProfileName, zipReady }: Props) {
  const usingProfile = Boolean(settings.tts.profileId);
  return (
    <div className="voice-card">
            <div className="voice-card-head"><Headphones size={15} /><span>音色</span></div>
            <div className="voice-card-body">
              <div className="voice-row">
                {usingProfile ? (
                  <div className="voice-input voice-current-profile" title={activeProfileName || settings.tts.profileId}>
                    当前音色：{activeProfileName || "我的音色"}
                  </div>
                ) : (
                  <AppSelect
                    className="voice-input"
                    value={String(settings.tts.sid)}
                    onChange={(v) => apply({ tts: { ...settings.tts, sid: Number(v) } })}
                    disabled={saving}
                    ariaLabel="音色"
                    options={voiceOptions.map((v) => ({ value: String(v.value), label: `基础 · ${v.label}` }))}
                  />
                )}
                <button className="secondary-setting voice-audition" onClick={() => void audition()} disabled={auditionPhase === "synth" || saving}>
                  {auditionPhase === "synth" ? <><Square size={13} />合成中…</> : auditionPhase === "playing" ? <><Square size={13} />停止</> : <><Play size={13} />试听</>}
                </button>
              </div>
              <div className="voice-card-hint">
                {usingProfile
                  ? "当前使用「我的音色」里选中的克隆音色（通话与播报都用它）。点「试听」验证；想换回机械的基础音色，到下方点「改回内置音色」。"
                  : zipReady
                    ? "还没选克隆音色，当前用基础音色（较机械）。到下方「内置音色」或「我的音色」里选一个，再点试听。"
                    : "音色克隆模型未安装，当前只能用基础音色。到下方「语音模型 → 音色克隆模型」下载后即可导入自己的音色。"}
                {usingProfile && !zipReady && " ⚠️ 音色克隆模型未就绪，当前实际会回退到基础音色。"}
              </div>
            </div>
          </div>
  );
}
