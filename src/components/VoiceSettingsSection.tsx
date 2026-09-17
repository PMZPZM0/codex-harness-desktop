/**
 * 语音通话设置（完整配套）：
 *   音色（带**试听**） / 语速 / 音量 / 麦克风（选择 + 电平测试 + 降噪回声消除开关）
 *   / 断句灵敏度 / 识别线程数 / 打断灵敏度 / 打断方式 / 模型镜像源
 *
 * 设计：每条设置**单独一张卡片**——标题一行、控件铺满卡片宽度、提示在底部。
 *
 * 状态由主进程持有（userData/voice-settings.json），通过 IPC 读写；
 * 改值后立即同步到主进程，**下一次**开始通话时生效（音色试听是即时的）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Upload, Headphones, Keyboard, Mic, Play, Radio, ShieldAlert, Sparkles, Square, Zap } from "lucide-react";
import { PageInfo } from "./SettingsHead";
import { decodeFloat32Base64 } from "../voice/audio-transport";
import { getWakeState, subscribeWakeState } from "../voice/wake-state";
import { hotkeyLabel } from "../lib/hotkey.mjs";

/** 渲染层平台（preload 透出的 process.platform，navigator 兜底）——
 *  语音快捷键的**录入**（⌘ 记 Command 还是 Super）与**显示**（⌘⇧M 还是 Ctrl+Shift+M）都按它分叉。
 *  ⛔ 09-17 审计：此前录入一律把 metaKey 记成 "Super"、显示直接打印 accelerator 原文，
 *  mac 用户看到的是 "Super+Shift+M" 这种没人认识的东西。 */
const IS_MAC_UI = (() => {
  const fromPreload = (window as any).codex?.platform;
  if (typeof fromPreload === "string" && fromPreload) return fromPreload === "darwin";
  return typeof navigator !== "undefined" && (navigator.platform?.toLowerCase().includes("mac") ?? false);
})();

/** 快捷键展示：accelerator 原文 → 当前平台习惯写法（mac：⌘⇧M）。 */
const showHotkey = (accelerator: string) => hotkeyLabel(accelerator, IS_MAC_UI ? "darwin" : "other");

type Settings = {
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
type Meta = {
  ttsVoices: Record<number, string>;
  modelHosts: Record<string, string>;
};

/** 试听播放：播放中可停止；done 在自然播完或手动停止时 resolve。 */
async function playSamples(samples: Float32Array | undefined, sampleRate: number | undefined): Promise<{ stop: () => void; done: Promise<void> }> {
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

      {/* 我的音色（音色克隆）：导入/录制一段参考音频 → 本机识别原文 → 用那个嗓音说话 */}
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

      {/* 断句灵敏度 */}
      <div className="voice-card">
        <div className="voice-card-head">
          <span>断句等待</span>
          <span className="voice-card-value">{settings.asr.rule1.toFixed(1)} 秒</span>
        </div>
        <div className="voice-card-body">
          <input
            className="voice-range"
            type="range"
            min={0.4}
            max={6.0}
            step={0.1}
            value={settings.asr.rule1}
            onChange={(e) => apply({ asr: { ...settings.asr, rule1: Number(e.target.value) } })}
            disabled={saving}
          />
          <div className="voice-card-hint">
            说完停多久算「这句说完了」。<strong>调小反应更快</strong>（0.4~1.2 秒），但容易被自己的停顿截断；调大更稳但等得久。
          </div>
        </div>
      </div>

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
      <div className="voice-card">
        <div className="voice-card-head"><span>打断方式</span></div>
        <div className="voice-card-body voice-card-body-row">
          <label className={`voice-radio ${settings.barge.mode === "auto" ? "active" : ""}`}>
            <input
              type="radio"
              name="bargeMode"
              value="auto"
              checked={settings.barge.mode === "auto"}
              onChange={() => apply({ barge: { gateDb: settings.barge.gateDb, mode: "auto" } })}
              disabled={saving}
            />
            <div className="voice-radio-body">
              <strong>自动</strong>
              <span>耳机 / 安静环境推荐；播报时检测到真人插话即停 TTS + turn/interrupt。</span>
            </div>
          </label>
          <label className={`voice-radio ${settings.barge.mode === "manual" ? "active" : ""}`}>
            <input
              type="radio"
              name="bargeMode"
              value="manual"
              checked={settings.barge.mode === "manual"}
              onChange={() => apply({ barge: { gateDb: settings.barge.gateDb, mode: "manual" } })}
              disabled={saving}
            />
            <div className="voice-radio-body">
              <strong>手动</strong>
              <span>外放推荐，避开回声误触；只有按「打断」按钮才停 TTS。</span>
            </div>
          </label>
        </div>
      </div>

      {/* 悬浮球（显示 / 随机气泡） */}
      <div className="voice-card">
        <div className="voice-card-head"><Sparkles size={15} /><span>悬浮球</span></div>
        <div className="voice-card-body">
          <div className="voice-toggles">
            <label className="voice-toggle">
              <input
                type="checkbox"
                checked={settings.ball.visible}
                onChange={(e) => apply({ ball: { visible: e.target.checked, hints: settings.ball.hints } })}
                disabled={saving}
              />
              <span>显示悬浮球</span>
            </label>
            <label className="voice-toggle">
              <input
                type="checkbox"
                checked={settings.ball.hints}
                onChange={(e) => apply({ ball: { visible: settings.ball.visible, hints: e.target.checked } })}
                disabled={saving}
              />
              <span>冒随机的短提示气泡</span>
            </label>
          </div>
          <div className="voice-card-hint">
            关掉显示后，可以回到这里重新打开；悬浮球上<strong>右键</strong>也能直接隐藏或跳到本页。
          </div>
        </div>
      </div>

      {/* 按键启动（全局快捷键） */}
      <div className="voice-card">
        <div className="voice-card-head"><Keyboard size={15} /><span>按键启动</span></div>
        <div className="voice-card-body">
          <div className="voice-row">
            <button className="secondary-setting" onClick={() => captureHotkey("call")} disabled={Boolean(capturing)}>
              {capturing === "call" ? "请按下组合键…（Esc 取消）" : "录入快捷键"}
            </button>
            <code className="voice-kbd">{showHotkey(settings.hotkey.accelerator) || "未设置"}</code>
            <label className="voice-toggle">
              <input
                type="checkbox"
                checked={settings.hotkey.enabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  // 与录入一致：注册/注销成功才落盘，失败保留原状态并提示
                  void window.codex.voiceHotkeySet({ accelerator: settings.hotkey.accelerator, enabled }).then((r: any) => {
                    if (!r?.ok) {
                      onNotice(`快捷键${enabled ? "注册" : "注销"}失败：${r?.error ?? "可能被其它程序占用"}`);
                      return;
                    }
                    apply({ hotkey: { enabled, accelerator: settings.hotkey.accelerator } });
                  });
                }}
                disabled={saving}
              />
              <span>启用（应用没聚焦也能唤起）</span>
            </label>
          </div>
          <div className="voice-card-hint">
            系统级快捷键，按一下开始、再按一下结束。需要至少带一个修饰键（{IS_MAC_UI ? "⌘ / ⇧ / ⌥" : "Ctrl / Shift / Alt"}），避免吞掉正常输入。
          </div>
        </div>
      </div>

      {/* 长按语音输入快捷键（仅应用内：按住开始听写，松开结束） */}
      <div className="voice-card">
        <div className="voice-card-head"><Mic size={15} /><span>长按语音输入</span></div>
        <div className="voice-card-body">
          <div className="voice-row">
            <button className="secondary-setting" onClick={() => captureHotkey("dictation")} disabled={Boolean(capturing)}>
              {capturing === "dictation" ? "请按下组合键…（Esc 取消）" : "录入长按快捷键"}
            </button>
            <code className="voice-kbd">{showHotkey(settings.dictationHotkey.accelerator) || "未设置"}</code>
            <label className="voice-toggle">
              <input
                type="checkbox"
                checked={settings.dictationHotkey.enabled}
                onChange={(e) => apply({ dictationHotkey: { enabled: e.target.checked, accelerator: settings.dictationHotkey.accelerator } })}
                disabled={saving}
              />
              <span>启用</span>
            </label>
          </div>
          <div className="voice-card-hint">
            在应用内<strong>按住</strong>快捷键开始语音输入，松开即结束；识别出的中文字幕会放进输入框，确认后再点发送。默认 Alt + Space。
          </div>
        </div>
      </div>

      {/* 语音唤醒 */}
      <div className="voice-card">
        <div className="voice-card-head"><Radio size={15} /><span>语音唤醒</span></div>
        <div className="voice-card-body">
          <label className="voice-toggle">
            <input
              type="checkbox"
              checked={settings.wake.enabled}
              onChange={(e) => apply({ wake: { enabled: e.target.checked, phrase: wakePhraseDraft || settings.wake.phrase } })}
              disabled={saving}
            />
            <span>持续聆听并等待唤醒词</span>
          </label>
          <input
            className="voice-input"
            value={wakePhraseDraft}
            placeholder="唤醒词，例如：小柯小柯"
            onChange={(e) => setWakePhraseDraft(e.target.value)}
            onBlur={commitWakePhrase}
            onKeyDown={(e) => { if (e.key === "Enter") commitWakePhrase(); }}
            disabled={saving}
          />
          <div className="voice-card-hint">
            说出唤醒词即可开始通话（识别文本归一化 + <strong>同音容错</strong>后再匹配：唤醒词只要求读音相同，
            所以「小柯小柯」能被「小科小科/小可小可」命中）。
            <strong>注意：开启后会持续占用 CPU</strong>——这里复用的是已有的识别模型，不是专门的低功耗唤醒模型；不用时建议关掉。
          </div>
          {/* 「为什么没唤醒」的唯一可用诊断：通用模型会把生僻字听成同音常用字，
              只有把「最近听到什么」显示出来，用户才知道该换词还是该改匹配。 */}
          <div className="voice-card-hint" data-voice-wake-status>
            {wakeState.error
              ? `唤醒未启动：${wakeState.error}`
              : wakeState.listening
                ? `正在聆听「${wakeState.phrase}」（${wakeState.engine === "kws" ? "关键词模型：只认读音、不误唤醒" : "识别模型匹配"}）${wakeState.device ? `｜麦克风：${wakeState.device}` : ""}${wakeState.heard ? `｜最近听到：${wakeState.heard}${wakeState.matched ? " ✅ 已命中" : ""}` : ""}`
                : settings.wake.enabled
                  ? "已开启：通话中会暂停聆听，挂断后自动恢复"
                  : "唤醒未开启（打开上面的开关并保持应用运行即可）"}
          </div>
          {wakeState.hint && <div className="voice-card-hint">⚠️ {wakeState.hint}</div>}
          {/* 关键词模型（KWS）：装了才是「只认读音、不误唤醒、CPU 低」的那条路 */}
          {kws && !kws.ready && (
            <div className="voice-row">
              <button className="secondary-setting" onClick={() => void installKws()} disabled={Boolean(kwsDownload)}>
                {kwsDownload ? `下载中 ${kwsDownload.percent >= 0 ? kwsDownload.percent + "%" : "…"}` : "下载唤醒模型（约 31MB，推荐）"}
              </button>
              {/* 下载可取消（用户 09-13：「还没有取消下载功能」）：取消会**保留**已下载的部分，
                  再点「下载」从断点续传，不必从头再来 */}
              {kwsDownload && (
                <button className="secondary-setting" onClick={() => void window.codex.voiceKwsCancel()}>
                  取消下载
                </button>
              )}
              <span className="voice-card-hint">不装也能用：会回退到识别模型匹配（更易误唤醒、更费 CPU）</span>
            </div>
          )}
          {kwsDownload && (
            <div className="voice-progress">
              <div className="voice-progress-bar">
                <span style={{ width: `${kwsDownload.percent >= 0 ? kwsDownload.percent : 5}%` }} />
              </div>
              <small>{kwsDownload.message}</small>
            </div>
          )}
        </div>
      </div>

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