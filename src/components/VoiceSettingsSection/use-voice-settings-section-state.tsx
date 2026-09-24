/**
 * useVoiceSettingsSectionState —— VoiceSettingsSection 的**状态与逻辑**（09-22 从 VoiceSettingsSection.tsx 提出，纯搬迁、零改写）。
 *
 * ⛔ 这些语句原本就是组件的体顶层语句 ⇒ 提成自定义 hook 后 hook 调用**顺序逐位不变**
 *    （同一渲染周期、同一顺序）。组件侧用**同名解构**接回来，所以 JSX 一字不改。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeFloat32Base64 } from "../../voice/audio-transport";
import { getWakeState, subscribeWakeState } from "../../voice/wake-state";
import { IS_MAC_UI, Settings, Meta, playSamples } from "../VoiceSettingsSection";

export function useVoiceSettingsSectionState({ onNotice }: { onNotice: (m: string) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);

  const [meta, setMeta] = useState<Meta | null>(null);

  const [saving, setSaving] = useState(false);

  const savingRef = useRef(false);


  // 试听：三态反馈（合成中 → 播放中 → 空闲），播放中再点一次 = 停止。
  // 旧实现只有「合成中…」一行字、没有播放态也不能停 = 用户反馈「没有试听播放反馈」。
  const playCtlRef = useRef<{ stop: () => void } | null>(null);

  const [auditionPhase, setAuditionPhase] = useState<"idle" | "synth" | "playing">("idle");

  const [profilePreview, setProfilePreview] = useState<{ id: string; phase: "synth" | "playing" } | null>(null);

  // 麦克风列表 + 电平测试
  const [mics, setMics] = useState<{ deviceId: string; label: string }[]>([]);

  const [micTesting, setMicTesting] = useState(false);

  const [micLevel, setMicLevel] = useState(0);

  // 快捷键录入中（通话快捷键 / 长按听写快捷键）
  const [capturing, setCapturing] = useState<"call" | "dictation" | null>(null);

  // 唤醒词草稿（输完失焦/回车才落盘，避免每敲一个字就写一次文件）
  const [wakePhraseDraft, setWakePhraseDraft] = useState("");

  /** 唤醒运行态（是否在听 / 最近听到什么 / 词表提示）——由 VoiceCallFloat 经 store 广播过来 */
  const [wakeState, setWakeState] = useState(getWakeState());

  useEffect(() => subscribeWakeState(setWakeState), []);

  /** 关键词唤醒模型（KWS）状态与下载进度：装了唤醒走「读音匹配」，不装回退识别模型 */
  const [kws, setKws] = useState<{ ready: boolean } | null>(null);

  const [kwsDownload, setKwsDownload] = useState<{ percent: number; message: string } | null>(null);

  const micTestRef = useRef<{ stop: () => void } | null>(null);

  // ── 我的音色（音色克隆 ZipVoice）──导入/录制参考音频 → 自动转写原文 → 保存为专属音色
  const [profiles, setProfiles] = useState<any[]>([]);

  const [zipReady, setZipReady] = useState(false);

  const [draft, setDraft] = useState<{ draftFile: string; refText: string; sourceName: string; durationSec: number } | null>(null);

  const [draftName, setDraftName] = useState("");

  const [profileBusy, setProfileBusy] = useState("");

  const [profileRecording, setProfileRecording] = useState(false);

  const recordingRef = useRef<{ stop: () => void } | null>(null);


  const reloadProfiles = useCallback(async () => {
    try {
      const r = await window.codex.voiceProfilesList();
      setProfiles(r.profiles ?? []);
      setZipReady(Boolean(r.zipvoiceReady));
    } catch (e: any) {
      onNotice(`读取音色列表失败：${e?.message ?? e}`);
    }
  }, [onNotice]);


  useEffect(() => { void reloadProfiles(); }, [reloadProfiles]);

  useEffect(() => () => { recordingRef.current?.stop(); }, []);


  const importProfile = useCallback(async () => {
    setProfileBusy("正在读取并识别音频…");
    try {
      const r = await window.codex.voiceProfilesImport();
      if (r?.canceled) { setProfileBusy(""); return; }
      if (!r?.ok) { onNotice(`导入失败：${r?.error ?? "未知"}`); setProfileBusy(""); return; }
      setDraft({ draftFile: r.draftFile, refText: r.refText ?? "", sourceName: r.sourceName ?? "音频", durationSec: r.durationSec ?? 0 });
      setDraftName("我的音色");
      setProfileBusy(r.refText ? "" : (r.transcribeError ? `自动识别未成功，请手填原文：${r.transcribeError}` : "自动识别未成功，请手填原文"));
      if (!r.refText) onNotice("没能自动识别出音频内容，请在下方手填音频里念的那句话");
    } catch (e: any) {
      onNotice(`导入失败：${e?.message ?? e}`);
      setProfileBusy("");
    }
  }, [onNotice]);


  const startProfileRecord = useCallback(async () => {
    setProfileBusy("正在录音…（最多 10 秒，说完点停止）");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (e: any) {
      setProfileBusy("");
      const name = String(e?.name ?? "");
      onNotice(name === "NotFoundError"
        ? "本机没有检测到麦克风 —— 请用「导入音频」选择一段录音文件"
        : `无法开始录音：${e?.message ?? e}`);
      return;
    }
    const ctx = new AudioContext({ sampleRate: 16000 });
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    proc.onaudioprocess = (event: any) => { chunks.push(new Float32Array(event.inputBuffer.getChannelData(0))); };
    source.connect(proc);
    proc.connect(ctx.destination);
    recordingRef.current = {
      stop: () => {
        recordingRef.current = null;
        try { source.disconnect(); proc.disconnect(); stream.getTracks().forEach((t) => t.stop()); void ctx.close(); } catch { /* 已断开 */ }
        setProfileRecording(false);
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const merged = new Float32Array(total);
        let offset = 0;
        for (const c of chunks) { merged.set(c, offset); offset += c.length; }
        setProfileBusy("正在识别录音…");
        window.codex.voiceProfilesRecord({ samples: Array.from(merged), sampleRate: ctx.sampleRate || 16000 })
          .then((r: any) => {
            if (!r?.ok) { onNotice(`录音处理失败：${r?.error ?? "未知"}`); setProfileBusy(""); return; }
            setDraft({ draftFile: r.draftFile, refText: r.refText ?? "", sourceName: "麦克风录制", durationSec: r.durationSec ?? 0 });
            setDraftName("我的音色");
            setProfileBusy(r.refText ? "" : "自动识别未成功，请手填原文");
          })
          .catch((e: any) => { onNotice(`录音处理失败：${e?.message ?? e}`); setProfileBusy(""); });
      },
    };
    setProfileRecording(true);
    window.setTimeout(() => recordingRef.current?.stop(), 10000);
  }, [onNotice]);


  const saveDraft = useCallback(async () => {
    if (!draft) return;
    setProfileBusy("正在保存音色…");
    const r = await window.codex.voiceProfilesSave({ draftFile: draft.draftFile, name: draftName, refText: draft.refText });
    setProfileBusy("");
    if (!r?.ok) { onNotice(`保存失败：${r?.error ?? "未知"}`); return; }
    setDraft(null);
    setDraftName("");
    await reloadProfiles();
    await window.codex.voiceProfilesSelect(r.profile.id).catch(() => undefined);
    onNotice(`音色「${r.profile.name}」已保存并启用`);
  }, [draft, draftName, reloadProfiles, onNotice]);


  const selectProfile = useCallback(async (id: string) => {
    await window.codex.voiceProfilesSelect(id).catch(() => undefined);
    const fresh = await window.codex.voiceSettingsGet().catch(() => null);
    if (fresh) setSettings(fresh.settings as Settings);
  }, []);


  const removeProfile = useCallback(async (id: string) => {
    await window.codex.voiceProfilesDelete(id).catch(() => undefined);
    await reloadProfiles();
  }, [reloadProfiles]);


  // ── 内置音色预设（台湾腔小美 / 贾维斯风管家）：一键创建档案并启用（参考文本随包，无需转写）──
  const [presets, setPresets] = useState<{ id: string; name: string; desc: string; lang: string; applied: boolean }[]>([]);

  useEffect(() => {
    window.codex.voicePresetList().then((r) => setPresets(r?.presets ?? [])).catch(() => undefined);
  }, []);

  const applyPreset = useCallback(async (presetId: string) => {
    setProfileBusy("正在创建内置音色…");
    try {
      const r = await window.codex.voicePresetApply(presetId);
      if (!r?.ok) { onNotice(`内置音色创建失败：${r?.error ?? "未知"}`); return; }
      await reloadProfiles();
      await window.codex.voiceProfilesSelect(r.profile.id).catch(() => undefined);
      const fresh = await window.codex.voiceSettingsGet().catch(() => null);
      if (fresh) setSettings(fresh.settings as Settings);
      window.codex.voicePresetList().then((pr) => setPresets(pr?.presets ?? [])).catch(() => undefined);
      onNotice(`内置音色「${r.profile.name}」已启用，点试听即可预览${r.existed ? "（已存在，直接复用）" : ""}`);
    } catch (e: any) {
      onNotice(`内置音色创建失败：${e?.message ?? e}`);
    } finally {
      setProfileBusy("");
    }
  }, [onNotice, reloadProfiles]);


  const previewProfile = useCallback(async (id: string) => {
    // 播放中再点同一行 = 停止
    if (playCtlRef.current && profilePreview?.id === id && profilePreview?.phase === "playing") {
      playCtlRef.current.stop();
      return;
    }
    // 换一个试听：先停掉正在播的
    playCtlRef.current?.stop();
    playCtlRef.current = null;
    setProfilePreview({ id, phase: "synth" });
    try {
      const r = await window.codex.voiceProfilesPreview({ id });
      if (!r?.ok) { onNotice(`试听失败：${r?.error ?? "未知"}`); return; }
      const samples = decodeFloat32Base64(r.audioBase64);
      if (!samples.length) { onNotice("试听失败：没有音频数据"); return; }
      const ctl = await playSamples(samples, r.sampleRate || 22050);
      playCtlRef.current = ctl;
      setProfilePreview({ id, phase: "playing" });
      await ctl.done;
    } catch (e: any) {
      onNotice(`试听失败：${e?.message ?? e}`);
    } finally {
      playCtlRef.current = null;
      setProfilePreview(null);
    }
  }, [onNotice, profilePreview]);


  /** 设置从主进程读回来后，同步一次唤醒词草稿 */
  const wakePhraseSyncedRef = useRef(false);


  useEffect(() => {
    let alive = true;
    window.codex.voiceSettingsGet()
      .then((res) => {
        if (!alive) return;
        setSettings(res.settings as Settings);
        setMeta({ ttsVoices: res.ttsVoices, modelHosts: res.modelHosts });
      })
      .catch((e: any) => onNotice(`读取语音设置失败：${e?.message ?? e}`));
    // 设备列表：标签要授权后才可读，拿不到就退化成「麦克风 N」
    navigator.mediaDevices?.enumerateDevices?.()
      .then((devices) => {
        if (!alive) return;
        const inputs = (devices ?? []).filter((d) => d.kind === "audioinput");
        setMics(inputs.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `麦克风 ${i + 1}` })));
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [onNotice]);


  // 关键词唤醒模型（KWS）状态 + 下载进度：进度从主进程的 voice:event（target="kws"）来
  useEffect(() => {
    let alive = true;
    const loadKws = () => {
      void window.codex.voiceModelsStatus()
        .then((s: any) => { if (alive && s?.kws) setKws({ ready: Boolean(s.kws.ready) }); })
        .catch(() => undefined);
    };
    loadKws();
    const off = window.codex.onVoiceEvent((event: any) => {
      if (event?.target !== "kws") return;
      if (event.type === "download") setKwsDownload({ percent: Number(event.percent ?? -1), message: String(event.message ?? "") });
      if (event.type === "downloadDone") {
        setKwsDownload(null);
        // 「已取消」不是错误：主进程会带上已下载的体积，提示用户再点会续传
        if (!event.ok && event.error) onNotice(String(event.error).includes("已取消") ? String(event.error) : `唤醒模型安装失败：${event.error}`);
        loadKws();
      }
    });
    return () => { alive = false; off?.(); };
  }, [onNotice]);


  const installKws = useCallback(async () => {
    setKwsDownload({ percent: 0, message: "准备下载…" });
    try {
      const result = await window.codex.voiceKwsInstall();
      if (!result?.ok) onNotice(`唤醒模型安装失败：${result?.error ?? "未知错误"}`);
    } catch (error: any) {
      onNotice(`唤醒模型安装失败：${error?.message ?? error}`);
    } finally {
      setKwsDownload(null);
      void window.codex.voiceModelsStatus()
        .then((s: any) => { if (s?.kws) setKws({ ready: Boolean(s.kws.ready) }); })
        .catch(() => undefined);
    }
  }, [onNotice]);


  // 卸载时停掉电平测试
  useEffect(() => () => { micTestRef.current?.stop(); }, []);


  const apply = useCallback((patch: Partial<Settings>) => {
    if (!settings || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const next: Settings = {
      ...settings,
      ...patch,
      tts: { ...settings.tts, ...(patch.tts ?? {}) },
      asr: { ...settings.asr, ...(patch.asr ?? {}) },
      mic: { ...settings.mic, ...(patch.mic ?? {}) },
      barge: { ...settings.barge, ...(patch.barge ?? {}) },
    };
    setSettings(next);
    window.codex.voiceSettingsSet(patch)
      .then((saved) => setSettings(saved as Settings))
      .catch((e: any) => onNotice(`保存语音设置失败：${e?.message ?? e}`))
      .finally(() => { savingRef.current = false; setSaving(false); });
  }, [settings, onNotice]);


  const audition = useCallback(async () => {
    if (!settings) return;
    // 播放中再点一次 = 停止播放
    if (playCtlRef.current) {
      playCtlRef.current.stop();
      return;
    }
    setAuditionPhase("synth");
    try {
      const r = await window.codex.voicePreviewVoice({ sid: settings.tts.sid, speed: settings.tts.speed });
      if (!r.ok) { onNotice(`试听失败：${r.error ?? "未知"}`); return; }
      const samples = decodeFloat32Base64(r.audioBase64);
      if (!samples.length) { onNotice("试听失败：合成结果没有音频数据"); return; }
      const ctl = await playSamples(samples, r.sampleRate);
      playCtlRef.current = ctl;
      setAuditionPhase("playing");
      await ctl.done;
    } catch (e: any) {
      onNotice(`试听失败：${e?.message ?? e}`);
    } finally {
      playCtlRef.current = null;
      setAuditionPhase("idle");
    }
  }, [settings, onNotice]);


  const toggleMicTest = useCallback(async () => {
    if (micTesting) {
      micTestRef.current?.stop();
      micTestRef.current = null;
      setMicTesting(false);
      setMicLevel(0);
      return;
    }
    if (!settings) return;
    try {
      const constraint: MediaTrackConstraints = {
        echoCancellation: settings.mic.echoCancellation,
        noiseSuppression: settings.mic.noiseSuppression,
        autoGainControl: settings.mic.autoGainControl,
      };
      if (settings.mic.deviceId) constraint.deviceId = { ideal: settings.mic.deviceId };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: constraint });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      let raf = 0;
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += v * v;
        setMicLevel(Math.min(1, Math.sqrt(sum / data.length) * 8));
        raf = requestAnimationFrame(tick);
      };
      tick();
      micTestRef.current = {
        stop: () => {
          cancelAnimationFrame(raf);
          src.disconnect();
          void ctx.close().catch(() => undefined);
          stream.getTracks().forEach((t) => t.stop());
        },
      };
      setMicTesting(true);
    } catch (e: any) {
      // 报错人话化：用户截图反馈「麦克风测试用不了」时，原始报错只有英文名
      // （实测无设备机器上是 NotFoundError | Requested device not found），看不出该修什么。
      const name = String(e?.name ?? "");
      const friendly = name === "NotFoundError"
        ? "系统里没有检测到可用的麦克风输入设备——请确认麦克风已接好、未被禁用，且已在「Windows 设置 → 隐私和安全性 → 麦克风」里允许桌面应用使用。"
        : name === "NotAllowedError"
          ? "麦克风权限被拒绝——请在「Windows 设置 → 隐私和安全性 → 麦克风」里允许桌面应用访问麦克风，然后重试。"
          : name === "NotReadableError"
            ? "麦克风被其它程序占用或硬件无响应——关掉正在录音/通话的程序（会议软件、录音机等）后重试。"
            : name === "OverconstrainedError"
              ? "所选麦克风当前不可用（可能已拔出）——换成「系统默认设备」再试。"
              : `${name || "未知错误"} ${e?.message ?? e}`;
      onNotice(`麦克风测试失败：${friendly}`);
    }
  }, [micTesting, settings, onNotice]);


  // 首次读到设置后同步唤醒词草稿（之后以用户输入为准，不再覆盖）
  useEffect(() => {
    if (!settings?.wake?.phrase || wakePhraseSyncedRef.current) return;
    setWakePhraseDraft(settings.wake.phrase);
    wakePhraseSyncedRef.current = true;
  }, [settings?.wake?.phrase]);


  /** 录入快捷键：按住组合键 → 翻译成 Electron accelerator 字符串 */
  const captureHotkey = useCallback((kind: "call" | "dictation" = "call") => {
    setCapturing(kind);
    const cleanup = () => {
      setCapturing(null);
      window.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { cleanup(); return; }
      // 必须带修饰键（单键会吞掉正常输入，不收）；还没按到修饰键时静默等待
      const mods: string[] = [];
      // ⌘ 在 mac 上就是那个主修饰键 → accelerator 记 "Command"；Windows 上 metaKey 是 Win 键 → 记 "Super"。
      // Electron 两者都认，但记错了在 mac 设置页里会显示成没人认识的 "Super"。
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.metaKey) mods.push(IS_MAC_UI ? "Command" : "Super"); // Win/Cmd 是独立修饰键，此前冒充 Ctrl 会导致注册的键与按的键对不上
      if (e.shiftKey) mods.push("Shift");
      if (e.altKey) mods.push("Alt");
      if (!mods.length) return;
      // 主键优先用 e.code（物理键位）：按 Ctrl+Shift+1 时 e.key 是「!」，按 e.key 匹配会
      // 静默丢弃——用户按了半天没反应，就是「改了一下就用不了」的另一半原因。
      const code = e.code ?? "";
      const letter = code.match(/^Key([A-Z])$/)?.[1];
      const digit = code.match(/^Digit([0-9])$/)?.[1];
      const fkey = code.match(/^F([1-9]|1[0-2])$/)?.[0];
      let main = letter ?? digit ?? fkey ?? "";
      if (!main && code === "Space") main = "Space";
      if (!main && /^[A-Z0-9]$/.test(e.key)) main = e.key;
      if (!main) {
        onNotice("这个键不能做快捷键（支持：字母 / 数字 / F1~F12 / Space，且至少带一个修饰键）");
        return;
      }
      const accelerator = [...mods, main].join("+");
      cleanup();
      if (kind === "dictation") {
        apply({ dictationHotkey: { enabled: true, accelerator } });
      } else {
        // 先注册、成功才落盘：注册失败时若先落盘，配置里存的就是一个注册不上的死键，
        // 且旧快捷键已被注销——重启后永远失联。失败保留原设置并明确提示。
        void window.codex.voiceHotkeySet({ accelerator, enabled: true }).then((r: any) => {
          if (!r?.ok) {
            onNotice(`快捷键「${accelerator}」注册失败，已保留原设置：${r?.error ?? "可能被其它程序占用"}`);
            return;
          }
          apply({ hotkey: { enabled: true, accelerator } });
        });
      }
    };
    window.addEventListener("keydown", onKey, true);
  }, [apply, onNotice]);


  const commitWakePhrase = useCallback(() => {
    if (!settings) return;
    const phrase = wakePhraseDraft.replace(/\s+/g, "").slice(0, 16);
    if (!phrase || phrase === settings.wake.phrase) return;
    apply({ wake: { enabled: settings.wake.enabled, phrase } });
  }, [settings, wakePhraseDraft, apply]);


  const voiceOptions = useMemo(() => {
    if (!meta) return [] as { value: number; label: string }[];
    return Object.entries(meta.ttsVoices)
      .map(([k, v]) => ({ value: Number(k), label: v }))
      .sort((a, b) => a.value - b.value);
  }, [meta]);

  return { onNotice, settings, setSettings, meta, setMeta, saving, setSaving, savingRef, playCtlRef, auditionPhase, setAuditionPhase, profilePreview, setProfilePreview, mics, setMics, micTesting, setMicTesting, micLevel, setMicLevel, capturing, setCapturing, wakePhraseDraft, setWakePhraseDraft, wakeState, setWakeState, kws, setKws, kwsDownload, setKwsDownload, micTestRef, profiles, setProfiles, zipReady, setZipReady, draft, setDraft, draftName, setDraftName, profileBusy, setProfileBusy, profileRecording, setProfileRecording, recordingRef, reloadProfiles, importProfile, startProfileRecord, saveDraft, selectProfile, removeProfile, presets, setPresets, applyPreset, previewProfile, wakePhraseSyncedRef, installKws, apply, audition, toggleMicTest, captureHotkey, commitWakePhrase, voiceOptions };
}
