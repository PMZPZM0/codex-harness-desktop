/**
 * VoiceSettingsSection —— **视图层**（09-22：状态与逻辑已提成 useVoiceSettingsSectionState，本文件只剩 JSX）。
 * ⛔ 解构名与 hook 返回键同名 ⇒ JSX 与搬迁前逐字一致。
 */
import { Trash2, Upload, Headphones, Keyboard, Mic, Play, Radio, ShieldAlert, Sparkles, Square, Zap } from "lucide-react";
import { AppSelect } from "./AppSelect";
import { PageInfo } from "./SettingsHead";
import { hotkeyLabel } from "../lib/hotkey.mjs";
import { useVoiceSettingsSectionState } from "./VoiceSettingsSection/use-voice-settings-section-state";
import { VoiceSettingsSectionVoicePicker } from "./VoiceSettingsSection/01-voice-picker";
import { VoiceSettingsSectionTtsEngines } from "./VoiceSettingsSection/02-tts-engines";
import { VoiceSettingsSectionVoiceCloneProfile } from "./VoiceSettingsSection/02-voice-clone-profile";
import { VoiceSettingsSectionMicDevices } from "./VoiceSettingsSection/03-mic-devices";
import { VoiceSettingsSectionEndpointWait } from "./VoiceSettingsSection/04-endpoint-wait";
import { VoiceSettingsSectionBargeMode } from "./VoiceSettingsSection/05-barge-mode";
import { VoiceSettingsSectionFloatingBall } from "./VoiceSettingsSection/06-floating-ball";
import { VoiceSettingsSectionHotkeyStart } from "./VoiceSettingsSection/07-hotkey-start";
import { VoiceSettingsSectionDictationHotkey } from "./VoiceSettingsSection/08-dictation-hotkey";
import { VoiceSettingsSectionAnnounce } from "./VoiceSettingsSection/10-announce";
import VoiceDevToolsSection from "./VoiceDevToolsSection";

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
  /* 10-26：合成引擎三选一。⛔ 渲染层与 electron 各有一份字面量（两边互不 import），
     加字段必须**两边同改**（electron/voice/voice-settings.ts 的 VoiceSettings.tts.engine）。 */
  tts: { sid: number; speed: number; volume: number; profileId?: string; numSteps?: number;
    engine?: "vits" | "kokoro" | "emotivoice"; };
  asr: { rule1: number; rule2: number; rule3: number; numThreads: number };
  mic: { deviceId: string; noiseSuppression: boolean; echoCancellation: boolean; autoGainControl: boolean };
  barge: { gateDb: number; mode: "auto" | "manual" };
  modelHost: "auto" | "huggingface" | "hf-mirror";
  hotkey: { enabled: boolean; accelerator: string };
  dictationHotkey: { enabled: boolean; accelerator: string };
  ball: { visible: boolean; hints: boolean; style: string; quiet?: boolean };
  /** 语音播报（10-09 第二轮收成一个总开关）：开 = 念 Codex 写的 `voice` 播报稿（通话里正文朗读也由它门控）。
   *  ⛔ 语速不在这里另开一份 —— 与通话共用 tts.speed（单一真相源）。 */
  announce: { enabled: boolean };
};

/**
 * 语速档位选项（10-08 新增）—— 与滑块改的是同一个 `tts.speed`，只是「一键到常用档」。
 * ⛔ 单一真相源：这里只放**候选值**，不存状态。
 */
export const VOICE_SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2] as const;
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
  const { settings, setSettings, meta, setMeta, saving, setSaving, savingRef, playCtlRef, auditionPhase, setAuditionPhase, profilePreview, setProfilePreview, mics, setMics, micTesting, setMicTesting, micLevel, setMicLevel, capturing, setCapturing, micTestRef, profiles, setProfiles, zipReady, setZipReady, ttsReady, draft, setDraft, draftName, setDraftName, profileBusy, setProfileBusy, profileRecording, setProfileRecording, recordingRef, reloadProfiles, importProfile, uploadProfile, startProfileRecord, saveDraft, selectProfile, removeProfile, presets, setPresets, applyPreset, previewProfile, apply, audition, toggleMicTest, captureHotkey, voiceOptions, reloadMeta } = useVoiceSettingsSectionState({ onNotice });
  /** 缺模型时直达「必需 · 基础语音模型」组（与引擎卡的跳转同一处落点）。 */
  const goModels = () => {
    const el = document.getElementById("voice-models");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("is-flash");
    window.setTimeout(() => el.classList.remove("is-flash"), 1400);
  };

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
      {/* 10-27 用户（语音页截图）：「把必须放到基础模型里面，然后这个首个卡片内容布局调一下，
          现在有点乱，然后上面一块空白删除，右上角帮助❓号里面的内容更新一下，放到基础模型卡片右上角」——
          ① 页头（.settings-copy）整块删掉：它只撑着 ? 的高度，删了上方那条空白行才真的消失；
          ② 「必需」标签 + 组说明并进基础模型卡（VoiceDevToolsSection 的卡头）；
          ③ 帮助 ? 改挂在基础模型卡右上角，文案重写成「这块是什么、怎么装」。 */}

      {/* ⛔⛔ 10-26 用户两轮实测：「我看不懂…好几个下载的地方，看的眼花缭乱」/「分好类、排序好，
          不装用不了的和拓展音色的要分开」⇒ 整页按**用途与依赖**分 4 组，每组一个标签说明性质：
             必需（基础模型）→ 可选（换引擎）→ 选声音（音色）→ 可选（克隆自己的声音）。
          ⛔ 别再把"下载"入口散落各处：基础模型只在「必需」组下载，引擎卡缺模型时只做跳转。 */}
      <div className="voice-group" id="voice-models">
        <VoiceDevToolsSection onNotice={onNotice} only="base" helpSlot={
          <PageInfo
            label="基础语音模型"
            helpKey="voice"
            text={<>必需模型：语音识别（zipformer）、断句端点检测（silero）、默认播报合成（vits-zh-ll）都在这一包里（约 270MB）。首次使用点「下载模型」——自动测速选最快的镜像；已有文件就点「本地导入」，支持 HF 快照 / 单个仓库 / 仓库根三种目录结构。不装它，语音通话与默认播报都用不了；换引擎（Kokoro 等）也仍要靠它做识别。</>}
          />
        } />
      </div>

      <div className="voice-group">
        <div className="voice-group-head">
          <span className="voice-group-tag is-optional">可选</span>
          <strong>换一个更好听的引擎</strong>
          <span className="voice-group-sub">不装也能用轻量播报；装好后到下面「音色」里挑声音</span>
        </div>
        <VoiceSettingsSectionTtsEngines apply={apply} onNotice={onNotice} reloadMeta={reloadMeta} settings={settings} />
      </div>

      <div className="voice-group">
        <div className="voice-group-head">
          <span className="voice-group-tag">选声音</span>
          <strong>音色与试听</strong>
          <span className="voice-group-sub">列表跟着当前引擎变（轻量播报 5 个 / Kokoro 103 个）</span>
        </div>
        <VoiceSettingsSectionVoicePicker apply={apply} audition={audition} auditionPhase={auditionPhase} saving={saving} settings={settings} voiceOptions={voiceOptions} activeProfileName={profiles.find((p: any) => p.id === settings.tts.profileId)?.name} zipReady={zipReady} />
      </div>

      <div className="voice-group">
        <div className="voice-group-head">
          <span className="voice-group-tag is-optional">可选</span>
          <strong>用自己的声音（音色克隆）</strong>
          <span className="voice-group-sub">先装 156MB 的克隆模型，再导入或录一段参考音频</span>
        </div>
        <VoiceDevToolsSection onNotice={onNotice} only="zipvoice" />
        <VoiceSettingsSectionVoiceCloneProfile applyPreset={applyPreset} draft={draft} draftName={draftName} importProfile={importProfile} uploadProfile={uploadProfile} presets={presets} previewProfile={previewProfile} profileBusy={profileBusy} profilePreview={profilePreview} profileRecording={profileRecording} profiles={profiles} recordingRef={recordingRef} removeProfile={removeProfile} saveDraft={saveDraft} selectProfile={selectProfile} setDraft={setDraft} setDraftName={setDraftName} setProfileBusy={setProfileBusy} settings={settings} startProfileRecord={startProfileRecord} zipReady={zipReady} />
      </div>


      {/* 日常：只影响播报与音量（⛔ 与"装什么"分开，别和模型混在一起） */}
      <div className="voice-group">
        <div className="voice-group-head">
          <span className="voice-group-tag">日常</span>
          <strong>播报 / 语速 / 音量</strong>
          <span className="voice-group-sub">只影响语音播报；语速与音量通话也共用</span>
        </div>
      {/* 语音播报：两个开关（实时正文 / 结束汇总） */}
      <VoiceSettingsSectionAnnounce apply={apply} saving={saving} settings={settings} ttsReady={ttsReady} onGoModels={goModels} />

      {/* 语速：档位 + 滑块（同一真相源 tts.speed —— 通话与语音播报共用） */}
      <div className="voice-card">
        <div className="voice-card-head">
          <span>语速</span>
          <span className="voice-card-value">{settings.tts.speed.toFixed(2)}×</span>
        </div>
        <div className="voice-card-body">
          <div className="voice-speed-presets" role="group" aria-label="语速档位">
            {VOICE_SPEED_PRESETS.map((speed) => (
              <button
                key={speed}
                type="button"
                className={`voice-speed-chip${Math.abs(settings.tts.speed - speed) < 0.001 ? " is-active" : ""}`}
                onClick={() => apply({ tts: { ...settings.tts, speed } })}
                disabled={saving}
                title={`切到 ${speed}×`}
              >
                {speed}×
              </button>
            ))}
          </div>
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
          <div className="voice-card-hint">慢 0.5× ↔ 快 2.0×；档位与滑块改的是同一个值（语音通话与语音播报共用）</div>
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

      </div>

      <details className="settings-exp-advanced">
        <summary>识别与通话细节 / 悬浮球 / 快捷键<small>高级</small></summary>
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

      {/* 镜像源 */}
      <div className="voice-card">
        <div className="voice-card-head"><Zap size={15} /><span>模型下载镜像源</span></div>
        <div className="voice-card-body">
          <AppSelect
            className="voice-input"
            value={settings.modelHost}
            onChange={(v) => apply({ modelHost: v as Settings["modelHost"] })}
            disabled={saving}
            ariaLabel="模型下载镜像源"
            options={Object.entries(meta.modelHosts).map(([k, v]) => ({ value: k, label: v }))}
          />
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
      </details>
    </section>
  );
}
