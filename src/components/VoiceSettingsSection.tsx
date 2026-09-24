/**
 * VoiceSettingsSection —— **视图层**（09-22：状态与逻辑已提成 useVoiceSettingsSectionState，本文件只剩 JSX）。
 * ⛔ 解构名与 hook 返回键同名 ⇒ JSX 与搬迁前逐字一致。
 */
import { Trash2, Upload, Headphones, Keyboard, Mic, Play, Radio, ShieldAlert, Sparkles, Square, Zap } from "lucide-react";
import { PageInfo } from "./SettingsHead";
import { hotkeyLabel } from "../lib/hotkey.mjs";
import { useVoiceSettingsSectionState } from "./VoiceSettingsSection/use-voice-settings-section-state";
import { VoiceSettingsSectionVoicePicker } from "./VoiceSettingsSection/01-voice-picker";
import { VoiceSettingsSectionVoiceCloneProfile } from "./VoiceSettingsSection/02-voice-clone-profile";
import { VoiceSettingsSectionMicDevices } from "./VoiceSettingsSection/03-mic-devices";
import { VoiceSettingsSectionEndpointWait } from "./VoiceSettingsSection/04-endpoint-wait";
import { VoiceSettingsSectionBargeMode } from "./VoiceSettingsSection/05-barge-mode";
import { VoiceSettingsSectionFloatingBall } from "./VoiceSettingsSection/06-floating-ball";
import { VoiceSettingsSectionHotkeyStart } from "./VoiceSettingsSection/07-hotkey-start";
import { VoiceSettingsSectionDictationHotkey } from "./VoiceSettingsSection/08-dictation-hotkey";
import { VoiceSettingsSectionWakeWord } from "./VoiceSettingsSection/09-wake-word";

/** 渲染层平台（preload 透出的 process.platform，navigator 兜底）——
 *  语音快捷键的**录入**（⌘ 记 Command 还是 Super）与**显示**（⌘⇧M 还是 Ctrl+Shift+M）都按它分叉。
 *  ⛔ 09-17 审计：此前录入一律把 metaKey 记成 "Super"、显示直接打印 accelerator 原文，
 *  mac 用户看到的是 "Super+Shift+M" 这种没人认识的东西。 */
export const IS_MAC_UI = (() => {
  const fromPreload = (window as any).codex?.platform;
  if (typeof fromPreload === "string" && fromPreload) return fromPreload === "darwin";
  return typeof navigator !== "undefined" && (navigator.platform?.toLowerCase().includes("mac") ?? false);
})();
/** 快捷键展示：accelerator 原文 → 当前平台习惯写法（mac：⌘⇧M）。 */
export const showHotkey = (accelerator: string) => hotkeyLabel(accelerator, IS_MAC_UI ? "darwin" : "other");
export type Settings = {
  tts: { sid: number; speed: number; volume: number; profileId?: string };
  asr: { rule1: number; rule2: number; rule3: number; numThreads: number };
  mic: { deviceId: string; noiseSuppression: boolean; echoCancellation: boolean; autoGainControl: boolean };
  barge: { gateDb: number; mode: "auto" | "manual" };
  modelHost: "auto" | "huggingface" | "hf-mirror";
  hotkey: { enabled: boolean; accelerator: string };
  dictationHotkey: { enabled: boolean; accelerator: string };
  wake: { enabled: boolean; phrase: string };
  ball: { visible: boolean; hints: boolean };
};
export type Meta = {
  ttsVoices: Record<number, string>;
  modelHosts: Record<string, string>;
};
/** 试听播放：播放中可停止；done 在自然播完或手动停止时 resolve。 */
export async function playSamples(samples: Float32Array | undefined, sampleRate: number | undefined): Promise<{ stop: () => void; done: Promise<void> }> {
  if (!samples || !sampleRate) throw new Error("没有音频数据");
  const ctx = new AudioContext();
  if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
  const buffer = ctx.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(new Float32Array(samples), 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  let onEnded: () => void = () => undefined;
  const done = new Promise<void>((resolve) => { onEnded = resolve; });
  let stopped = false;
  src.onended = () => {
    if (!stopped) { void ctx.close().catch(() => undefined); onEnded(); }
  };
  src.start();
  return {
    stop: () => {
      stopped = true;
      try { src.stop(); } catch { /* 已结束 */ }
      void ctx.close().catch(() => undefined);
      onEnded();
    },
    done,
  };
}

export default function VoiceSettingsSection({ onNotice }: { onNotice: (m: string) => void }) {
  const { settings, setSettings, meta, setMeta, saving, setSaving, savingRef, playCtlRef, auditionPhase, setAuditionPhase, profilePreview, setProfilePreview, mics, setMics, micTesting, setMicTesting, micLevel, setMicLevel, capturing, setCapturing, wakePhraseDraft, setWakePhraseDraft, wakeState, setWakeState, kws, setKws, kwsDownload, setKwsDownload, micTestRef, profiles, setProfiles, zipReady, setZipReady, draft, setDraft, draftName, setDraftName, profileBusy, setProfileBusy, profileRecording, setProfileRecording, recordingRef, reloadProfiles, importProfile, startProfileRecord, saveDraft, selectProfile, removeProfile, presets, setPresets, applyPreset, previewProfile, wakePhraseSyncedRef, installKws, apply, audition, toggleMicTest, captureHotkey, commitWakePhrase, voiceOptions } = useVoiceSettingsSectionState({ onNotice });
    if (!settings || !meta) {
    return (
      <section className="settings-section stack voice-settings">
        <div className="settings-section-title">语音通话</div>
        <div className="voice-settings-loading">读取中…</div>
      </section>
    );
  }
  return (
    <section className="settings-section stack voice-settings">
      <div className="settings-section-title">
        语音通话
        <PageInfo
          label="语音通话"
          helpKey="voice"
          text={<>本机离线识别与合成（<code>sherpa-onnx</code>）。点右下角悬浮球开始通话；改值后下次通话生效（试听即时）。</>}
        />
      </div>

      {/* 音色 + 试听 */}
      <VoiceSettingsSectionVoicePicker apply={apply} audition={audition} auditionPhase={auditionPhase} saving={saving} settings={settings} voiceOptions={voiceOptions} />

      {/* 我的音色（音色克隆）：导入/录制一段参考音频 → 本机识别原文 → 用那个嗓音说话 */}
      <VoiceSettingsSectionVoiceCloneProfile applyPreset={applyPreset} draft={draft} draftName={draftName} importProfile={importProfile} presets={presets} previewProfile={previewProfile} profileBusy={profileBusy} profilePreview={profilePreview} profileRecording={profileRecording} profiles={profiles} recordingRef={recordingRef} removeProfile={removeProfile} saveDraft={saveDraft} selectProfile={selectProfile} setDraft={setDraft} setDraftName={setDraftName} setProfileBusy={setProfileBusy} settings={settings} startProfileRecord={startProfileRecord} zipReady={zipReady} />

      {/* 语速 */}
      <div className="voice-card">
        <div className="voice-card-head">
          <span>语速</span>
          <span className="voice-card-value">{settings.tts.speed.toFixed(2)}×</span>
        </div>
        <div className="voice-card-body">
          <input
            className="voice-range"
            type="range"
            min={0.5}
            max={2.0}
            step={0.05}
            value={settings.tts.speed}
            onChange={(e) => apply({ tts: { ...settings.tts, speed: Number(e.target.value) } })}
            disabled={saving}
          />
          <div className="voice-card-hint">慢 0.5× ↔ 快 2.0×</div>
        </div>
      </div>

      {/* 音量 */}
      <div className="voice-card">
        <div className="voice-card-head">
          <span>播报音量</span>
          <span className="voice-card-value">{Math.round(settings.tts.volume * 100)}%</span>
        </div>
        <div className="voice-card-body">
          <input
            className="voice-range"
            type="range"
            min={0}
            max={2.0}
            step={0.05}
            value={settings.tts.volume}
            onChange={(e) => apply({ tts: { ...settings.tts, volume: Number(e.target.value) } })}
            disabled={saving}
          />
          <div className="voice-card-hint">0%（静音）↔ 100%（原始音量）↔ 200%（放大）</div>
        </div>
      </div>

      {/* 麦克风 */}
      <VoiceSettingsSectionMicDevices apply={apply} micLevel={micLevel} micTesting={micTesting} mics={mics} saving={saving} settings={settings} toggleMicTest={toggleMicTest} />

      {/* 断句灵敏度 */}
      <VoiceSettingsSectionEndpointWait apply={apply} saving={saving} settings={settings} />

      {/* 长句阈值 */}
      <div className="voice-card">
        <div className="voice-card-head">
          <span>长句提前断句</span>
          <span className="voice-card-value">{settings.asr.rule2.toFixed(1)} 秒</span>
        </div>
        <div className="voice-card-body">
          <input
            className="voice-range"
            type="range"
            min={0.2}
            max={4.0}
            step={0.1}
            value={settings.asr.rule2}
            onChange={(e) => apply({ asr: { ...settings.asr, rule2: Number(e.target.value) } })}
            disabled={saving}
          />
          <div className="voice-card-hint">已经说了一大段时，用更短的停顿就断句（避免长句子憋着不提交）。</div>
        </div>
      </div>

      {/* 单句上限 */}
      <div className="voice-card">
        <div className="voice-card-head">
          <span>单句最长时长</span>
          <span className="voice-card-value">{settings.asr.rule3} 秒</span>
        </div>
        <div className="voice-card-body">
          <input
            className="voice-range"
            type="range"
            min={3}
            max={60}
            step={1}
            value={settings.asr.rule3}
            onChange={(e) => apply({ asr: { ...settings.asr, rule3: Number(e.target.value) } })}
            disabled={saving}
          />
          <div className="voice-card-hint">到点强制成句提交，防止一直不停地说导致迟迟不出字。</div>
        </div>
      </div>

      {/* 识别线程数 */}
      <div className="voice-card">
        <div className="voice-card-head">
          <span>识别线程数</span>
          <span className="voice-card-value">{settings.asr.numThreads} 线程</span>
        </div>
        <div className="voice-card-body">
          <input
            className="voice-range"
            type="range"
            min={1}
            max={4}
            step={1}
            value={settings.asr.numThreads}
            onChange={(e) => apply({ asr: { ...settings.asr, numThreads: Number(e.target.value) } })}
            disabled={saving}
          />
          <div className="voice-card-hint">CPU 核心多可以调高（识别更跟手）；机器弱或要省电就调低。</div>
        </div>
      </div>

      {/* 打断灵敏度 */}
      <div className="voice-card">
        <div className="voice-card-head">
          <Mic size={15} /><span>打断灵敏度</span>
          <span className="voice-card-value">{settings.barge.gateDb} dB</span>
        </div>
        <div className="voice-card-body">
          <input
            className="voice-range"
            type="range"
            min={3}
            max={12}
            step={1}
            value={settings.barge.gateDb}
            onChange={(e) => apply({ barge: { gateDb: Number(e.target.value), mode: settings.barge.mode } })}
            disabled={saving}
          />
          <div className="voice-card-hint">安静环境 6~8 / 外放或嘈杂 10~12 减少误触发</div>
        </div>
      </div>

      {/* 打断方式 */}
      <VoiceSettingsSectionBargeMode apply={apply} saving={saving} settings={settings} />

      {/* 悬浮球（显示 / 随机气泡） */}
      <VoiceSettingsSectionFloatingBall apply={apply} saving={saving} settings={settings} />

      {/* 按键启动（全局快捷键） */}
      <VoiceSettingsSectionHotkeyStart apply={apply} captureHotkey={captureHotkey} capturing={capturing} onNotice={onNotice} saving={saving} settings={settings} />

      {/* 长按语音输入快捷键（仅应用内：按住开始听写，松开结束） */}
      <VoiceSettingsSectionDictationHotkey apply={apply} captureHotkey={captureHotkey} capturing={capturing} saving={saving} settings={settings} />

      {/* 语音唤醒 */}
      <VoiceSettingsSectionWakeWord apply={apply} commitWakePhrase={commitWakePhrase} installKws={installKws} kws={kws} kwsDownload={kwsDownload} saving={saving} setWakePhraseDraft={setWakePhraseDraft} settings={settings} wakePhraseDraft={wakePhraseDraft} wakeState={wakeState} />

      {/* 镜像源 */}
      <div className="voice-card">
        <div className="voice-card-head"><Zap size={15} /><span>模型下载镜像源</span></div>
        <div className="voice-card-body">
          <select
            className="voice-input"
            value={settings.modelHost}
            onChange={(e) => apply({ modelHost: e.target.value as Settings["modelHost"] })}
            disabled={saving}
          >
            {Object.entries(meta.modelHosts).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <div className="voice-card-hint">自动模式会先并发 HEAD 测速，按延迟排序选最快源；强制模式只走指定源。</div>
        </div>
      </div>

      <div className="voice-card voice-card-note">
        <ShieldAlert size={15} />
        <span>
          {settings.barge.mode === "manual"
            ? "手动模式下，播报时你说话不会自动停 TTS——需要点「打断」按钮才会停。"
            : "自动模式下，播报时检测到真人插话（高于回声地板）即自动停 TTS 并 turn/interrupt。"}
        </span>
      </div>
    </section>
  );
}
