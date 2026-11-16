/**
 * VoiceSettingsSectionVoicePicker —— VoiceSettingsSection 的 JSX 第 1 段（09-22 从 VoiceSettingsSection.tsx 分出，纯搬迁）。
 * ⛔ props 类型由 TypeChecker 从**原作用域**推断（不是 any）⇒ 静态检查强度不降。
 */
import { Headphones, Play, Square } from "lucide-react";
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
  /** 「我的音色」全部档案：外部引擎/克隆模式下它就是**音色来源**（参考音频）。 */
  profiles?: { id: string; name: string }[];
  /** 切换参考音色（与「我的音色」卡片同一个动作，不另造语义）。 */
  onSelectProfile?: (id: string) => void;
  /** 选中本机模型音色：真正切回本机引擎合成（外部引擎接管时先停用），见页面侧实现。 */
  onUseLocalVoice?: (sid: number) => void;
  zipReady: boolean;
  /** 主进程认定的**当前真正在合成的那条链**（外部引擎 > 克隆 > MOSS > 本机）。 */
  speech?: { effective: string; ready: boolean; label: string; reason: string } | null;
};

/** 音色选择卡：列当前引擎的内置音色，可试听、可切到克隆音色。 */
export function VoiceSettingsSectionVoicePicker({ audition, auditionPhase, saving, settings, voiceOptions, activeProfileName, profiles = [], onSelectProfile, onUseLocalVoice, zipReady, speech }: Props) {
  /* ⛔ 11-16 用户实测两连：「音色压根没联动语音模型」→「换了模型点试听还是旧的内置音色」→
     「压根没有语音模型音色」。结论：**一个下拉必须同时给出两类嗓子**——
       · 本机音色：当前模型自带的真实说话人（读 G_multisperaker_latest.json，不是「音色 1..5」）；
       · 我的音色：参考音频（外部引擎克隆 / 本机音色克隆都用它）。
     选中「本机音色」= 真的用本机引擎合成（外部引擎接管时先停用）；选「我的音色」= 当前引擎拿它当参考。
     ⛔ 只列参考音频的版本会把「模型音色」整个藏掉（用户截图点名）。 */
  const external = speech?.effective === "external";
  const moss = speech?.effective === "moss";
  const noEngine = speech?.effective === "none";
  const externalRefName = profiles.find((p) => p.id === settings.tts.profileId)?.name ?? "";
  const usingProfile = Boolean(settings.tts.profileId);
  const value = settings.tts.profileId
    ? `profile:${settings.tts.profileId}`
    : (external ? "" : `local:${settings.tts.sid}`);
  const options = [
    ...(external && !usingProfile ? [{ value: "", label: "未选参考音色（外部引擎不出声）" }] : []),
    ...voiceOptions.map((v) => ({ value: `local:${v.value}`, label: `本机音色 · ${v.label}` })),
    ...profiles.map((p) => ({ value: `profile:${p.id}`, label: `我的音色 · ${p.name}` })),
  ];
  const pick = (next: string) => {
    if (next.startsWith("profile:")) { onSelectProfile?.(next.slice("profile:".length)); return; }
    if (next.startsWith("local:")) { onUseLocalVoice?.(Number(next.slice("local:".length))); }
  };
  return (
    <div className="voice-card">
            <div className="voice-card-head"><Headphones size={15} /><span>音色</span></div>
            <div className="voice-card-body">
              <div className="voice-row">
                {moss ? (
                  <div className="voice-input voice-current-profile" title={speech?.label || ""}>
                    当前音色：{speech?.label || "MOSS-TTS"} · 云端
                  </div>
                ) : noEngine ? (
                  <div className="voice-input voice-current-profile" title={speech?.reason || ""}>
                    当前没有可用的语音合成引擎
                  </div>
                ) : (
                  <AppSelect
                    className="voice-input"
                    value={value}
                    onChange={pick}
                    disabled={saving}
                    ariaLabel="音色"
                    title={usingProfile ? (activeProfileName || settings.tts.profileId) : `本机音色 · ${settings.tts.sid}`}
                    options={options}
                  />
                )}
                <button className="secondary-setting voice-audition" onClick={() => void audition()} disabled={auditionPhase === "synth" || saving}>
                  {auditionPhase === "synth" ? <><Square size={13} />合成中…</> : auditionPhase === "playing" ? <><Square size={13} />停止</> : <><Play size={13} />试听</>}
                </button>
              </div>
              <div className="voice-card-hint">
                {moss
                  ? "当前播报由 MOSS-TTS 云端合成，音色在云端的 MOSS 弹窗里选。"
                  : noEngine
                    ? (speech?.reason || "先在本页第 1 步安装基础模型，或在上方启用外部语音引擎。")
                    : external
                      ? usingProfile
                        ? `当前由「${speech?.label || "外部引擎"}」克隆「${externalRefName || activeProfileName || "我的音色"}」合成。换「本机音色」会切回本机引擎（外部引擎停用）；换「我的音色」就换参考音频，想加新声音到下方导入 / 上传 / 录制。`
                        : `当前由「${speech?.label || "外部引擎"}」接管，但它要用一段参考音频才能出声：选一个「我的音色」，或直接选「本机音色」用本机引擎合成。点「试听」验证。`
                      : usingProfile
                        ? `当前用「我的音色」里的克隆音色（${activeProfileName || "我的音色"}）合成，通话与播报都用它。选「本机音色」可换回模型自带嗓子。`
                        : `下表是当前基础模型自带的音色（${Math.max(1, voiceOptions.length)} 个真实说话人），下拉可切换；想用自己的声音，到下方「我的音色」导入/录制${zipReady ? "" : "（需先装音色克隆模型）"}。`}
                {usingProfile && !zipReady && !external && " ⚠️ 音色克隆模型未就绪，当前实际会回退到基础音色。"}
              </div>
            </div>
          </div>
  );
}
