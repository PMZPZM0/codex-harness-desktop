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
  /** 「我的音色」全部档案：外部引擎模式下它就是**音色来源**（参考音频），下拉直接选。 */
  profiles?: { id: string; name: string }[];
  /** 切换参考音色（与「我的音色」卡片同一个动作，不另造语义）。 */
  onSelectProfile?: (id: string) => void;
  zipReady: boolean;
  /** 主进程认定的**当前真正在合成的那条链**（外部引擎 > 克隆 > MOSS > 本机）。
   *  ⛔ 音色选择必须跟着它走：外部引擎/MOSS 生效时，本机的「音色 1..5」是死的。 */
  speech?: { effective: string; ready: boolean; label: string; reason: string } | null;
};

/** 音色选择卡：列当前引擎的内置音色，可试听、可切到克隆音色。 */
export function VoiceSettingsSectionVoicePicker({ apply, audition, auditionPhase, saving, settings, voiceOptions, activeProfileName, profiles = [], onSelectProfile, zipReady, speech }: Props) {
  const usingProfile = Boolean(settings.tts.profileId);
  /* 11-11 移除 Kokoro 后只剩基础音色一套，前缀固定「基础」。 */
  const engineLabel = "基础";
  /* ⛔ 11-16 用户实测「音色压根没联动语音模型」：启用了外部引擎（如 GPT-SoVITS / Chatterbox）时，
     基础音色下拉是死的（合成根本不过它）⇒ 外面直接显示当前引擎，不再给假选择。
     ⛔ 第二版（同日）：外部引擎的「音色」= 「我的音色」里选中的参考音频 —— 这里必须能直接换它，
        否则用户以为「换了模型还是旧声音」（真实根因是试听没走外部引擎，主进程已修）。 */
  const external = speech?.effective === "external";
  const moss = speech?.effective === "moss";
  const externalRefName = profiles.find((p) => p.id === settings.tts.profileId)?.name ?? "";
  /* 旧主进程没有 speech 字段时按本机处理（保持原行为）；新主进程明确 none 时不再给假下拉。 */
  const localActive = !speech || speech.effective === "local";
  const noEngine = speech?.effective === "none";
  return (
    <div className="voice-card">
            <div className="voice-card-head"><Headphones size={15} /><span>音色</span></div>
            <div className="voice-card-body">
              <div className="voice-row">
                {external ? (
                  profiles.length ? (
                    <AppSelect
                      className="voice-input"
                      value={String(settings.tts.profileId ?? "")}
                      onChange={(v) => onSelectProfile?.(v)}
                      disabled={saving}
                      ariaLabel="参考音色"
                      title={externalRefName || "未选参考音色"}
                      options={[
                        { value: "", label: "未选参考音色（外部引擎不出声）" },
                        ...profiles.map((p) => ({ value: p.id, label: p.name })),
                      ]}
                    />
                  ) : (
                    <div className="voice-input voice-current-profile" title={speech?.reason || ""}>
                      {externalRefName || "还没有参考音色"}
                    </div>
                  )
                ) : moss ? (
                  <div className="voice-input voice-current-profile" title={speech?.label || ""}>
                    当前音色：{speech?.label || "MOSS-TTS"} · 云端
                  </div>
                ) : usingProfile ? (
                  <div className="voice-input voice-current-profile" title={activeProfileName || settings.tts.profileId}>
                    当前音色：{activeProfileName || "我的音色"}
                  </div>
                ) : noEngine ? (
                  <div className="voice-input voice-current-profile" title={speech?.reason || ""}>
                    当前没有可用的语音合成引擎
                  </div>
                ) : localActive ? (
                  <AppSelect
                    className="voice-input"
                    value={String(settings.tts.sid)}
                    onChange={(v) => apply({ tts: { ...settings.tts, sid: Number(v) } })}
                    disabled={saving}
                    ariaLabel="音色"
                    options={voiceOptions.map((v) => ({ value: String(v.value), label: `${engineLabel} · ${v.label}` }))}
                  />
                ) : null}
                <button className="secondary-setting voice-audition" onClick={() => void audition()} disabled={auditionPhase === "synth" || saving}>
                  {auditionPhase === "synth" ? <><Square size={13} />合成中…</> : auditionPhase === "playing" ? <><Square size={13} />停止</> : <><Play size={13} />试听</>}
                </button>
              </div>
              <div className="voice-card-hint">
                {external
                  ? externalRefName
                    ? `音色 = 参考音频：由「${speech?.label || "外部引擎"}」克隆「${externalRefName}」的声音来合成。下拉换一个「我的音色」就换嗓子；想用新声音，到下方「我的音色」导入 / 上传 / 录制。点「试听」直接用当前引擎合成。`
                    : `外部引擎「${speech?.label || "外部引擎"}」必须要一段参考音频才能出声：到下方「我的音色」导入 / 上传 / 录制一个并选中，再回来点「试听」。`
                  : moss
                    ? "当前播报由 MOSS-TTS 云端合成，音色在云端的 MOSS 弹窗里选。"
                    : noEngine
                      ? (speech?.reason || "先在本页第 1 步安装基础模型，或在上方启用外部语音引擎。")
                      : usingProfile
                        ? "当前使用「我的音色」里选中的克隆音色（通话与播报都用它）。点「试听」验证；想换回机械的基础音色，到下方点「改回内置音色」。"
                        : `下表是当前基础模型自带的音色（${Math.max(1, voiceOptions.length)} 个），下拉可切换；想用自己的声音，到下方「我的音色」导入/录制${zipReady ? "" : "（需先装音色克隆模型）"}。`}
                {usingProfile && !zipReady && !external && " ⚠️ 音色克隆模型未就绪，当前实际会回退到基础音色。"}
              </div>
            </div>
          </div>
  );
}
