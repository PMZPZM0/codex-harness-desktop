/**
 * VoiceSettingsSectionVoiceCloneProfile —— VoiceSettingsSection 的 JSX 第 2 段（09-22 从 VoiceSettingsSection.tsx 分出，纯搬迁）。
 * ⛔ props 类型由 TypeChecker 从**原作用域**推断（不是 any）⇒ 静态检查强度不降。
 */
import { Trash2, Upload, Headphones, Keyboard, Mic, Play, Radio, ShieldAlert, Sparkles, Square, Zap } from "lucide-react";
import { Settings } from "../VoiceSettingsSection";

type Props = {
  applyPreset: (presetId: string) => Promise<void>;
  draft: { draftFile: string; refText: string; sourceName: string; durationSec: number; } | null;
  draftName: string;
  importProfile: () => Promise<void>;
  presets: { id: string; name: string; desc: string; lang: string; applied: boolean; }[];
  previewProfile: (id: string) => Promise<void>;
  profileBusy: string;
  profilePreview: { id: string; phase: "synth" | "playing"; } | null;
  profileRecording: boolean;
  profiles: any[];
  recordingRef: React.RefObject<{ stop: () => void; } | null>;
  removeProfile: (id: string) => Promise<void>;
  saveDraft: () => Promise<void>;
  selectProfile: (id: string) => Promise<void>;
  setDraft: React.Dispatch<React.SetStateAction<{ draftFile: string; refText: string; sourceName: string; durationSec: number; } | null>>;
  setDraftName: React.Dispatch<React.SetStateAction<string>>;
  setProfileBusy: React.Dispatch<React.SetStateAction<string>>;
  settings: Settings;
  startProfileRecord: () => Promise<void>;
  zipReady: boolean;
};

export function VoiceSettingsSectionVoiceCloneProfile({ applyPreset, draft, draftName, importProfile, presets, previewProfile, profileBusy, profilePreview, profileRecording, profiles, recordingRef, removeProfile, saveDraft, selectProfile, setDraft, setDraftName, setProfileBusy, settings, startProfileRecord, zipReady }: Props) {
  return (
    <div className="voice-card">
            <div className="voice-card-head"><Headphones size={15} /><span>我的音色（音色克隆）</span></div>
            <div className="voice-card-body">
              {!zipReady ? (
                <div className="voice-card-hint">
                  还没安装音色克隆模型：到「设置 → 开发工具 → 音色克隆模型」下载（约 156MB），装好后这里就能导入或录制音色。
                </div>
              ) : !draft ? (
                <div className="voice-row">
                  <button className="secondary-setting" onClick={() => void importProfile()} disabled={Boolean(profileBusy) || profileRecording}>
                    <Upload size={13} />导入音频（wav）
                  </button>
                  <button className="secondary-setting" onClick={() => (profileRecording ? recordingRef.current?.stop() : void startProfileRecord())} disabled={Boolean(profileBusy) && !profileRecording}>
                    <Mic size={13} />{profileRecording ? "停止录音" : "录制 10 秒"}
                  </button>
                </div>
              ) : (
                <div className="voice-profile-draft">
                  <div className="voice-card-hint">
                    来源：{draft.sourceName}{draft.durationSec ? `（${draft.durationSec} 秒）` : ""} —— 下面是自动识别出的原文，
                    <b>请核对成音频里真正念的那句话</b>（对不上会让克隆音质明显变差）。
                  </div>
                  <textarea
                    className="voice-input"
                    rows={3}
                    value={draft.refText}
                    onChange={(e) => setDraft({ ...draft, refText: e.target.value })}
                    placeholder="音频里念的那句话（必须与音频一致）"
                  />
                  <div className="voice-row">
                    <input className="voice-input" value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="给这个音色起个名字" />
                    <button className="primary-setting" onClick={() => void saveDraft()} disabled={!draftName.trim() || !draft.refText.trim()}>保存</button>
                    <button className="secondary-setting" onClick={() => { setDraft(null); setDraftName(""); setProfileBusy(""); }}>取消</button>
                  </div>
                </div>
              )}
    
              {profileBusy && <div className="voice-card-hint">{profileBusy}</div>}
    
              {/* 内置音色预设：一键创建 + 启用（需要已安装音色克隆模型） */}
              {zipReady && presets.length > 0 && (
                <div className="voice-profile-list">
                  <div className="voice-card-hint">内置音色（一键启用）：</div>
                  {presets.map((preset) => (
                    <div key={preset.id} className="voice-profile-item">
                      <span className="voice-profile-pick"><span>{preset.name}</span><em>{preset.lang === "zh" ? "中" : "英"}</em></span>
                      <button className="secondary-setting" title={preset.desc} onClick={() => void applyPreset(preset.id)} disabled={Boolean(profileBusy)}>
                        {preset.applied ? "复用" : "启用"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
    
              {profiles.length > 0 && (
                <div className="voice-profile-list">
                  {profiles.map((p) => {
                    const pv = profilePreview;
                    const previewPhase = pv && pv.id === p.id ? pv.phase : null;
                    return (
                    <div key={p.id} className="voice-profile-item">
                      <label className="voice-profile-pick">
                        <input
                          type="radio"
                          name="voice-profile"
                          checked={(settings?.tts?.profileId ?? "") === p.id}
                          onChange={() => void selectProfile(p.id)}
                        />
                        <span>{p.name}</span>
                        <em>{p.durationSec}s</em>
                      </label>
                      <button
                        className="secondary-setting"
                        onClick={() => void previewProfile(p.id)}
                        disabled={previewPhase === "synth" && previewPhase !== null}
                      >
                        {previewPhase === "synth"
                          ? <><Square size={12} />合成中…</>
                          : previewPhase === "playing"
                            ? <><Square size={12} />停止</>
                            : <><Play size={12} />试听</>}
                      </button>
                      <button className="secondary-setting" onClick={() => void removeProfile(p.id)}><Trash2 size={12} />删除</button>
                    </div>
                    );
                  })}
                  {(settings?.tts?.profileId ?? "") && (
                    <button className="secondary-setting" onClick={() => void selectProfile("")}>改回内置音色</button>
                  )}
                </div>
              )}
            </div>
          </div>
  );
}
