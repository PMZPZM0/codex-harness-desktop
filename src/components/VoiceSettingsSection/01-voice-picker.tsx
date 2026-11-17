/**
 * VoiceSettingsSectionVoicePicker —— 基础模型（轻量播报）自己的音色卡（09-22 从 VoiceSettingsSection.tsx 分出）。
 *
 * 11-17 用户令：「每个语音模型都加几个默认音色进去……每个语音模型独立的更干净，互相独立，
 * 互不影响，配置都是独立的」⇒ 这张卡从「音色与克隆」公共区搬进**轻量播报卡自己的配置弹窗**，
 * 并且把音色从下拉改成**列表**：默认音色（模型自带说话人）与「我的音色」分组列出，一眼看到有几个。
 *
 * ⛔ 选「本机音色」= 真的切回本机引擎合成（外部引擎接管时先停用，见页面侧 useLocalVoice）；
 * 选「我的音色」= 用该克隆档案当参考音频。两类嗓子必须在同一个地方能选到。
 */
import { Headphones, Play, Square } from "lucide-react";
import { Settings } from "../VoiceSettingsSection";

type Props = {
  apply: (patch: Partial<import("../VoiceSettingsSection.tsx").Settings>) => void;
  audition: () => Promise<void>;
  auditionPhase: "idle" | "synth" | "playing";
  saving: boolean;
  settings: Settings;
  voiceOptions: { value: number; label: string; }[];
  /** 当前选中的「我的音色」名称（空 = 用基础音色）——卡头必须显示它，
   *  否则选中克隆音色后列表还停在默认音色，用户会以为没切换（10-21 报障）。 */
  activeProfileName?: string;
  /** 「我的音色」全部档案：外部引擎/克隆模式下它就是**音色来源**（参考音频）。 */
  profiles?: { id: string; name: string; builtIn?: boolean }[];
  /** 切换参考音色（与「我的音色」卡片同一个动作，不另造语义）。 */
  onSelectProfile?: (id: string) => void;
  /** 选中本机模型音色：真正切回本机引擎合成（外部引擎接管时先停用），见页面侧实现。 */
  onUseLocalVoice?: (sid: number) => void;
  zipReady: boolean;
  /** 主进程认定的**当前真正在合成的那条链**（外部引擎 > 克隆 > MOSS > 本机）。 */
  speech?: { effective: string; ready: boolean; label: string; reason: string } | null;
};

/** 轻量播报的音色卡：默认音色 + 我的音色列表，可试听；外部引擎接管时提示去哪里选。 */
export function VoiceSettingsSectionVoicePicker({ audition, auditionPhase, saving, settings, voiceOptions, activeProfileName, profiles = [], onSelectProfile, onUseLocalVoice, zipReady, speech }: Props) {
  const external = speech?.effective === "external";
  const moss = speech?.effective === "moss";
  const noEngine = speech?.effective === "none";
  const usingProfile = Boolean(settings.tts.profileId);
  const currentName = usingProfile
    ? (activeProfileName || "我的音色")
    : (voiceOptions.find((voice) => voice.value === settings.tts.sid)?.label || `音色 ${settings.tts.sid + 1}`);
  const pickLocal = (sid: number) => { if (!saving) onUseLocalVoice?.(sid); };
  const pickProfile = (id: string) => { if (!saving) onSelectProfile?.(id); };

  return (
    <div className="voice-card" data-base-voices="1">
      <div className="voice-card-head">
        <Headphones size={15} />
        <span>音色</span>
        <span className="voice-card-value">{moss ? "MOSS 云端" : noEngine ? "无可用引擎" : currentName}</span>
      </div>
      <div className="voice-card-body">
        {moss ? (
          <div className="voice-input voice-current-profile" title={speech?.label || ""}>
            当前音色：{speech?.label || "MOSS-TTS"} · 云端
          </div>
        ) : (
          <>
            {/* 11-17：没有可用引擎时**照样列出默认音色**（每个模型都有几张底牌），只是全部禁用并说明原因 ——
                ⛔ 不做一个能选中却不出声的假下拉。 */}
            {noEngine && (
              <div className="voice-card-hint" title={speech?.reason || ""}>
                当前没有可用的语音合成引擎：先在上方安装基础模型，下面的音色才能选。
              </div>
            )}
            <div className="voice-subhead">
              <strong>默认音色</strong>
              <span className="voice-group-sub">当前基础模型自带的真实说话人，点选即用</span>
            </div>
            {voiceOptions.length ? (
              <div className="voice-profile-list">
                {voiceOptions.map((voice) => (
                  <div key={voice.value} className="voice-profile-item">
                    <label className="voice-profile-pick">
                      <input
                        type="radio"
                        name="base-voice"
                        checked={!usingProfile && settings.tts.sid === voice.value}
                        disabled={saving || noEngine}
                        onChange={() => pickLocal(voice.value)}
                      />
                      <span>{voice.label}</span>
                      <em>模型</em>
                    </label>
                  </div>
                ))}
              </div>
            ) : (
              <div className="voice-card-hint">基础模型自带音色还没读出来：先在上方安装/导入基础语音模型。</div>
            )}

            <div className="voice-subhead">
              <strong>我的音色</strong>
              <span className="voice-group-sub">导入、录制或克隆的参考音频；选中后优先于默认音色</span>
            </div>
            {profiles.length ? (
              <div className="voice-profile-list">
                {profiles.map((profile) => (
                  <div key={profile.id} className="voice-profile-item">
                    <label className="voice-profile-pick">
                      <input
                        type="radio"
                        name="base-voice"
                        checked={settings.tts.profileId === profile.id}
                        disabled={!zipReady || saving || noEngine}
                        title={!zipReady ? "先安装音色克隆模型，装好后才能选用克隆音色" : undefined}
                        onChange={() => pickProfile(profile.id)}
                      />
                      <span>{profile.name}</span>
                      <em>{profile.builtIn ? "内置" : "我的"}</em>
                    </label>
                  </div>
                ))}
              </div>
            ) : (
              <div className="voice-card-hint">
                还没有自己的音色：回到「基础模型」弹窗里的「我的音色（音色克隆）」导入、上传或录一段参考音频{cloneHint(zipReady)}。
              </div>
            )}

            <div className="voice-row">
              <button className="secondary-setting voice-audition" onClick={() => void audition()} disabled={auditionPhase === "synth" || saving || noEngine}>
                {auditionPhase === "synth" ? <><Square size={13} />合成中…</> : auditionPhase === "playing" ? <><Square size={13} />停止</> : <><Play size={13} />试听</>}
              </button>
              {usingProfile && (
                <button className="secondary-setting" onClick={() => pickLocal(settings.tts.sid)} disabled={saving}>
                  改回默认音色
                </button>
              )}
            </div>
          </>
        )}
        <div className="voice-card-hint">
          {moss
            ? "当前播报由 MOSS-TTS 云端合成，音色在云端的 MOSS 弹窗里选。"
            : noEngine
              ? (speech?.reason || "先在本页第 1 步安装基础模型，或在上方启用外部语音引擎。")
              : external
                ? `当前由「${speech?.label || "外部引擎"}」接管：它自己的音色在对应引擎卡里选。这里选音色会切回本机引擎。`
                : usingProfile
                  ? `当前用「我的音色」里的克隆音色（${activeProfileName || "我的音色"}）合成，通话与播报都用它。`
                  : `当前用默认音色「${currentName}」；音色按模型独立保存，换到别的语音模型不会改动这里。`}
          {usingProfile && !zipReady && !external && " ⚠️ 音色克隆模型未就绪，当前实际会回退到基础音色。"}
        </div>
      </div>
    </div>
  );
}

/** 克隆模型未就绪时的提示尾巴（避免每处写两份不同的说法）。 */
function cloneHint(zipReady: boolean): string {
  return zipReady ? "" : "（需先安装音色克隆模型）";
}
