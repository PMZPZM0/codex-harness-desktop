/**
 * 语音通话悬浮入口（完全独立组件，不侵入任何既有 UI）。
 *
 * 设计铁律：本组件是**旁挂**——不改输入框、不改发送/排队、不改任何既有面板。
 * 挂断后释放麦克风、AudioContext、工作线程与全部监听，界面回到原样。
 *
 * 分工：
 * - 渲染层（本组件）：麦克风采集、回声消除（需要采样对齐的播放参考）、回声门控、
 *   断句、播放、以及「正在播报时的电平/状态」。
 * - 主进程：语音识别与合成（工作线程里跑 ONNX）、把识别文本交给引擎、把引擎增量转回来。
 *
 * 跨平台：Windows / macOS 通用。macOS 首次使用会弹系统麦克风授权框（主进程已接
 * `systemPreferences.askForMediaAccess`）；权限被拒时给出明确提示而不是静默失败。
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, AudioLines, Download, EyeOff, LoaderCircle, Mic, PhoneOff, Settings2, X } from "lucide-react";
import { createAec, createEchoGate, createSentenceChunker, resampleLinear, rmsOf } from "../lib/voice-aec.mjs";
import { CAPTURE_WORKLET_SOURCE } from "../voice/capture-worklet";
import { decodeFloat32Base64 } from "../voice/audio-transport";
import VoiceMascot from "./VoiceMascot";
import { patchVoiceStage, requestVoiceDictationSend, requestVoiceOpenSettings, resetVoiceStage, setVoiceDictationHandler, setVoiceLevel, setVoiceStopHandler } from "../voice/wave-level";

type VoicePhase = "idle" | "starting" | "active";
type VoiceState = "listening" | "thinking" | "speaking";

type ModelsStatus = { ready: boolean; missing: string[]; readyFiles: number; totalFiles: number; bytes: number };

const POS_KEY = "voice-float-pos";
const DEFAULT_POS = { right: 22, bottom: 104 };
const CAPTURE_RATE = 16000;
const BARGUE_COOLDOWN_MS = 1200;

/**
 * 悬浮球的随机短提示词——按任务状态**分池**，每条池里是"运行状态/搞笑话语/个性化"三类混合。
 *
 * **刻意写得很短（≤6 字）**：气泡是从悬浮球往左弹出的，太长会盖住输入框。
 * 所以每条都压到 6 个字以内，配合设置里的"是否弹出"开关，不想要可以关掉。
 * 弹的频率也调低了（15~25 秒一次，显示 3 秒）——之前 7~12 秒太吵。
 */
const HINT_POOLS: Record<string, string[]> = {
  // 待机（ball 显示但通话没开）
  idle: [
    "点我开始 →",
    "戳我说话",
    "右键可隐藏",
    "今天聊点啥",
    "我在呢",
    "说句话呗",
  ],
  // 启动中
  starting: [
    "准备中…",
    "马上好…",
  ],
  // 聆听
  listening: [
    "我在听…",
    "慢慢说",
    "嗯，在听",
    "继续说",
  ],
  // 思考
  thinking: [
    "想想…",
    "让我想想",
    "算一下…",
    "有意思",
  ],
  // 播报
  speaking: [
    "我在说…",
    "可打断我",
    "稍等…",
  ],
  // 模型没下完
  modelsMissing: [
    "先下模型",
    "去设置下",
    "还没准备好",
  ],
};

/** 按当前 phase/state/模型状态挑一个最合适的池子随机抽 */
function pickHint(phase: VoicePhase, state: VoiceState, modelsReady: boolean): string {
  let pool: string[];
  if (!modelsReady && phase !== "active") {
    pool = HINT_POOLS.modelsMissing;
  } else if (phase === "active") {
    pool = HINT_POOLS[state] ?? HINT_POOLS.idle;
  } else if (phase === "starting") {
    pool = HINT_POOLS.starting;
  } else {
    pool = HINT_POOLS.idle;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(0)} MB`;
}

function readPos(): { right: number; bottom: number } {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return DEFAULT_POS;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.right === "number" && typeof parsed?.bottom === "number") return parsed;
  } catch {
    /* 坏数据就当没存过 */
  }
  return DEFAULT_POS;
}

export default function VoiceCallFloat({ threadId }: { threadId?: string }) {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [state, setState] = useState<VoiceState>("listening");
  const [expanded, setExpanded] = useState(false);
  const [level, setLevel] = useState(0);
  const [userText, setUserText] = useState("");
  const [agentText, setAgentText] = useState("");
  // 悬浮球显隐（设置里可关）+ 随机提示气泡
  const [ballVisible, setBallVisible] = useState(true);
  const [hintsEnabled, setHintsEnabled] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  // 右键菜单位置：做视口边界检测（看用户截图：之前直接用 clientX/Y 会跑出屏幕）
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // 字幕广播用：delta 是逐字累加的，用 ref 拿累计值，避免依赖 state 更新时机
  const agentTextRef = useRef("");
  /** 悬浮球 DOM：每帧把音量写进 CSS 变量，让球跟着声音呼吸/发光 */
  const ballRef = useRef<HTMLButtonElement | null>(null);
  const [notice, setNotice] = useState("");
  const [models, setModels] = useState<ModelsStatus | null>(null);
  const [download, setDownload] = useState<{ percent: number; message: string } | null>(null);
  const [pos, setPos] = useState(readPos);

  // 采集与播放（全部是 ref，避免 React 重渲染打断音频链路）
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const playQueueRef = useRef<AudioBufferSourceNode[]>([]);
  const playingCountRef = useRef(0);
  const aecRef = useRef<any>(null);
  const bargeModeRef = useRef<"auto" | "manual">("auto");
  /** 麦克风约束（设备选择 + 降噪/回声消除/自动增益），从设置读到后给 getUserMedia 用 */
  const micSettingsRef = useRef<{
    deviceId: string;
    noiseSuppression: boolean;
    echoCancellation: boolean;
    autoGainControl: boolean;
  }>({ deviceId: "", noiseSuppression: false, echoCancellation: true, autoGainControl: false });
  /** 播报音量（TTS 输出增益，1.0 = 原音量） */
  const volumeRef = useRef(1);
  const gateRef = useRef<any>(null);
  const chunkerRef = useRef<any>(null);
  const refRingRef = useRef<Float32Array>(new Float32Array(CAPTURE_RATE * 2));
  const refWriteRef = useRef(0);
  const refReadRef = useRef(0);
  const lastBargeAtRef = useRef(0);
  const speakingRef = useRef(false);
  const phaseRef = useRef<VoicePhase>("idle");
  /** conversation=正常通话；dictation=只把识别内容回填输入框 */
  const voiceModeRef = useRef<"conversation" | "dictation">("conversation");
  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  phaseRef.current = phase;

  // ---- 模型状态 ----
  const refreshModels = useCallback(async () => {
    try {
      const status = await window.codex.voiceModelsStatus();
      setModels({
        ready: status.ready,
        missing: status.missing ?? [],
        readyFiles: status.readyFiles,
        totalFiles: status.totalFiles,
        bytes: status.bytes,
      });
    } catch {
      setModels(null);
    }
  }, []);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  // 读悬浮球显隐 + 气泡开关（设置页改完即时生效）
  useEffect(() => {
    void window.codex.voiceSettingsGet().then((s: any) => {
      const b = s?.settings?.ball;
      if (!b) return;
      setBallVisible(b.visible !== false);
      setHintsEnabled(b.hints !== false);
    }).catch(() => undefined);
  }, []);

  // 随机短提示气泡：按当前 phase/state/模型就绪 选池子
  // 频率刻意调低：首次 3 秒，之后每 15~25 秒冒一句，显示 3 秒后收起
  // （之前 7~12 秒一次、显示 4 秒——用户反馈"太吵 + 太长会盖住输入框"）
  useEffect(() => {
    if (!hintsEnabled) { setHint(null); return; }
    let timer = 0;
    let hideTimer = 0;
    const tick = () => {
      setHint(pickHint(phase, state, models?.ready ?? false));
      hideTimer = window.setTimeout(() => setHint(null), 3000);
      timer = window.setTimeout(tick, 15000 + Math.random() * 10000);
    };
    timer = window.setTimeout(tick, 3000);
    return () => { window.clearTimeout(timer); window.clearTimeout(hideTimer); };
    // 依赖 phase/state/modelsReady —— 状态变了下一条提示会立刻刷新成对应池
  }, [hintsEnabled, phase, state, models?.ready]);

  // 点空白处收起右键菜单
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [menu]);

  /** 右键菜单：隐藏 / 跳转到语音设置 */
  const onBallContextMenu = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 菜单大小约 150×88。鼠标处为锚点，越右/下边就贴回视口边内
    // —— 直接用 clientX/Y 在 52px 的小窗口里会被聊天区遮住、跑出屏幕。
    const W = 158;
    const H = 88;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = Math.max(6, Math.min(e.clientX, vw - W - 6));
    const y = Math.max(6, Math.min(e.clientY, vh - H - 6));
    setMenu({ x, y });
  }, []);

  const hideBall = useCallback(() => {
    setBallVisible(false);
    setMenu(null);
    setHint(null);
    // 落盘，下次启动保持隐藏（设置页可以再打开）
    void window.codex.voiceSettingsSet({ ball: { visible: false, hints: hintsEnabled } }).catch(() => undefined);
  }, [hintsEnabled]);

  // ---- 主进程事件 ----
  useEffect(() => {
    const off = window.codex.onVoiceEvent((event: any) => {
      if (!event || typeof event !== "object") return;
      if (event.type === "state") {
        setState(event.state);
        // 舞台模式跟随通话状态（聆听/思考/播报）
        patchVoiceStage({ mode: event.state === "speaking" ? "speaking" : event.state === "thinking" ? "thinking" : "listening" });
        return;
      }
      if (event.type === "partial") {
        setUserText(event.text);
        patchVoiceStage({ userText: String(event.text ?? "") });
        return;
      }
      if (event.type === "final") {
        setUserText(event.text);
        setAgentText("");
        agentTextRef.current = "";
        patchVoiceStage({ userText: String(event.text ?? ""), agentText: "" });
        return;
      }
      if (event.type === "delta") {
        const piece = String(event.text ?? "");
        setAgentText((prev) => {
          const next = prev + piece;
          agentTextRef.current = next;
          return next;
        });
        // 舞台字幕用 ref 里的累计值（不依赖 state 更新时机）
        patchVoiceStage({ agentText: agentTextRef.current });
        void speakDelta(piece);
        return;
      }
      if (event.type === "turnDone") {
        void flushSpeech();
        return;
      }
      if (event.type === "error") {
        setNotice(String(event.message ?? ""));
        return;
      }
      if (event.type === "download") {
        setDownload({ percent: Number(event.percent ?? -1), message: String(event.message ?? "") });
      }
      if (event.type === "downloadDone") {
        // 下载/导入完成后立即刷一次模型状态——面板里 "语音模型未下载 (0/12)"
        // 和底部红字要切到"已就绪"（不刷就会停在旧的未下载状态）
        setDownload(null);
        setNotice("");
        void refreshModels();
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 播放队列 ----
  const pushRef = useCallback((samples: Float32Array) => {
    const ring = refRingRef.current;
    for (let i = 0; i < samples.length; i++) {
      ring[refWriteRef.current % ring.length] = samples[i];
      refWriteRef.current += 1;
    }
  }, []);

  const enqueuePlay = useCallback(async (samples: Float32Array, sampleRate: number) => {
    if (!playCtxRef.current) {
      playCtxRef.current = new AudioContext();
    }
    const ctx = playCtxRef.current;
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);

    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    // copyToChannel 要求底层是 ArrayBuffer（跨 IPC 过来的可能是 ArrayBufferLike），拷一份最稳
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // 音量：设置里的 tts.volume（1.0 = 原音量）；走 GainNode 便于随时改且不影响 AEC 参考
    const gain = ctx.createGain();
    gain.gain.value = volumeRef.current;
    source.connect(gain);
    gain.connect(ctx.destination);
    // 分一路给 AnalyserNode：波浪要"跟着 Codex 声音波动"——TTS 输出电平从这里取
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    gain.connect(analyser);
    const scopeData = new Float32Array(analyser.fftSize);
    const scopeTimer = window.setInterval(() => {
      if (!speakingRef.current) return;
      analyser.getFloatTimeDomainData(scopeData);
      let sum = 0;
      for (const v of scopeData) sum += v * v;
      const rms = Math.sqrt(sum / scopeData.length);
      const level = Math.min(1, rms * 6);
      ballRef.current?.style.setProperty("--voice-level", level.toFixed(3));
      setVoiceLevel(level, "speaking");
    }, 60);

    // 把这段音频写进 AEC 参考环（重采样到采集率）
    pushRef(sampleRate === CAPTURE_RATE ? samples : resampleLinear(samples, sampleRate, CAPTURE_RATE));

    const last = playQueueRef.current[playQueueRef.current.length - 1];
    const startAt = last ? Math.max(ctx.currentTime, (last as any).__endsAt ?? 0) : ctx.currentTime;
    (source as any).__endsAt = startAt + buffer.duration;
    playQueueRef.current.push(source);
    playingCountRef.current += 1;
    speakingRef.current = true;
    source.onended = () => {
      window.clearInterval(scopeTimer);
      playingCountRef.current = Math.max(0, playingCountRef.current - 1);
      playQueueRef.current = playQueueRef.current.filter((item) => item !== source);
      if (playingCountRef.current === 0) {
        speakingRef.current = false;
        gateRef.current?.reset();
        void window.codex.voicePlaybackDone().catch(() => undefined);
      }
    };
    source.start(startAt);
  }, [pushRef]);

  const stopPlayback = useCallback(() => {
    for (const source of playQueueRef.current) {
      try {
        source.stop();
      } catch {
        /* 已停止 */
      }
    }
    playQueueRef.current = [];
    playingCountRef.current = 0;
    speakingRef.current = false;
    gateRef.current?.reset();
  }, []);

  // ---- 断句 → 合成 → 播放 ----
  const speakDelta = useCallback(
    async (delta: string) => {
      if (!chunkerRef.current) chunkerRef.current = createSentenceChunker({ maxChars: 60 });
      const sentences: string[] = chunkerRef.current.push(delta);
      for (const sentence of sentences) {
        const result = await window.codex.voiceSpeak(sentence).catch(() => null);
        if (!result?.ok || !result.audioBase64 || !result.sampleRate) {
          if (result && !result.ok && result.error) setNotice(result.error);
          continue;
        }
        const samples = decodeFloat32Base64(result.audioBase64);
        if (samples.length) await enqueuePlay(samples, result.sampleRate);
      }
    },
    [enqueuePlay]
  );

  const flushSpeech = useCallback(async () => {
    const rest: string[] = chunkerRef.current?.flush() ?? [];
    for (const sentence of rest) {
      const result = await window.codex.voiceSpeak(sentence).catch(() => null);
      if (result?.ok && result.audioBase64 && result.sampleRate) {
        const samples = decodeFloat32Base64(result.audioBase64);
        if (samples.length) await enqueuePlay(samples, result.sampleRate);
      }
    }
  }, [enqueuePlay]);

  // ---- 采集链路 ----
  const startCapture = useCallback(async () => {
    const permission = await window.codex.voiceMicPermission().catch(() => ({ status: "unknown" }));
    if (permission.status !== "granted") {
      throw new Error(
        permission.status === "denied" || permission.status === "restricted"
          ? "麦克风权限被拒绝，请在系统设置里允许本应用使用麦克风"
          : "无法获取麦克风权限"
      );
    }
    const mic = micSettingsRef.current;
      let stream: MediaStream;
      const audioConstraint: MediaTrackConstraints = {
        echoCancellation: mic.echoCancellation,
        noiseSuppression: mic.noiseSuppression,
        autoGainControl: mic.autoGainControl,
        channelCount: 1,
      };
      // 指定了设备才加 deviceId（空串 = 系统默认）；设备被拔掉时放宽为 ideal，
      // 避免 OverconstrainedError 直接打不开——宁可用默认设备也别整个失败。
      if (mic.deviceId) {
        audioConstraint.deviceId = { ideal: mic.deviceId };
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
      } catch (error: any) {
        // getUserMedia 报错名 → 人话 + 排查提示（开发工具里也能定位）
        const name = String(error?.name ?? "");
        const msg = String(error?.message ?? error);
        if (name === "NotFoundError" || /requested device not found/i.test(msg)) {
          throw new Error("未找到可用的麦克风设备（Requested device not found）。请检查：(1) 麦克风已物理接入并被系统识别；(2) 没有被其它程序独占（浏览器、Zoom、VoiceMeeter、OBS 等）；(3) Windows：在「设置 → 系统 → 声音」里能看到输入设备且没禁用；macOS：在「系统设置 → 隐私与安全 → 麦克风」授权本应用。也可以在「设置 → 语音通话 → 麦克风」里换一个输入设备试试。");
        }
        if (name === "NotAllowedError" || name === "SecurityError") {
          throw new Error("麦克风权限被拒绝。请到系统的「麦克风隐私设置」里授权本应用，然后重试。");
        }
        if (name === "NotReadableError" || /in use/i.test(msg)) {
          throw new Error("麦克风正被其它程序独占（could not start audio source）。请关掉占用麦克风的应用再试。");
        }
        if (name === "OverconstrainedError") {
          throw new Error("请求的麦克风参数不被设备支持（OverconstrainedError）。通常是采样率/通道数不匹配，或所选设备已不可用——可到「设置 → 语音通话 → 麦克风」改回系统默认。");
        }
        throw new Error(`打开麦克风失败：${msg}`);
      }
    mediaStreamRef.current = stream;

    const ctx = new AudioContext({ sampleRate: CAPTURE_RATE });
    captureCtxRef.current = ctx;
    const blobUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: "text/javascript" }));
    try {
      await ctx.audioWorklet.addModule(blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }

    aecRef.current = createAec({ filterLength: 512, delay: 480, step: 0.12 });
    // 打断方式 + 灵敏度从设置取：auto=能量门控自动打断，manual=仅手动按钮（外放场景避免误触发）
    const settings = await window.codex.voiceSettingsGet().catch(() => null);
    const s = settings?.settings;
    const bargeMode = s?.barge?.mode ?? "auto";
    const gateDb = s?.barge?.gateDb ?? 6;
    micSettingsRef.current = s?.mic ?? { deviceId: "", noiseSuppression: false, echoCancellation: true, autoGainControl: false };
    volumeRef.current = s?.tts?.volume ?? 1;
    gateRef.current = createEchoGate({ echoGateDb: gateDb });
    bargeModeRef.current = bargeMode;

    const node = new AudioWorkletNode(ctx, "voice-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    });
    workletRef.current = node;
    ctx.createMediaStreamSource(stream).connect(node);

    node.port.onmessage = (event: MessageEvent) => {
      if (phaseRef.current !== "active") return;
      const raw = event.data as Float32Array;
      if (!raw || !raw.length) return;

      // 参考信号与麦克风对齐：按块读取（近似对齐，真实偏移由 AEC 的 delay 线吸收）
      const ring = refRingRef.current;
      const ref = new Float32Array(raw.length);
      const available = Math.min(raw.length, Math.max(0, refWriteRef.current - refReadRef.current));
      for (let i = 0; i < available; i++) {
        ref[i] = ring[(refReadRef.current + i) % ring.length];
      }
      refReadRef.current += raw.length;

      const cleaned = aecRef.current ? aecRef.current.process(raw, ref) : raw;
      const rms = rmsOf(cleaned);
      const nextLevel = Math.min(1, rms * 12);
      setLevel(nextLevel);
      // 悬浮球跟着音量呼吸（写 CSS 变量，不用 state，避免每帧重渲染）
      ballRef.current?.style.setProperty("--voice-level", nextLevel.toFixed(3));
      // 广播给输入框上方的波浪（播报时不抢 Codex 的电平，避免两边互相抖动）
      if (!speakingRef.current) setVoiceLevel(nextLevel, "listening");

      // 播报期门控：只有「能量显著高于回声地板」才算真人插话
      const doubleTalk = gateRef.current?.update(rms, speakingRef.current) ?? false;
      aecRef.current?.setFrozen(doubleTalk);
      // manual 模式：只算出门控，不自动打断——让用户用「打断」按钮（外放场景避免误触发）
      if (doubleTalk && bargeModeRef.current === "auto" && Date.now() - lastBargeAtRef.current > BARGUE_COOLDOWN_MS) {
        lastBargeAtRef.current = Date.now();
        stopPlayback();
        void window.codex.voiceBarge().catch(() => undefined);
      }

      window.codex.voiceAudio(cleaned);
    };
  }, [stopPlayback]);

  const teardown = useCallback(async () => {
    stopPlayback();
    try {
      workletRef.current?.port.postMessage({ type: "stop" });
      workletRef.current?.disconnect();
    } catch {
      /* 已断开 */
    }
    workletRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    await captureCtxRef.current?.close().catch(() => undefined);
    captureCtxRef.current = null;
    await playCtxRef.current?.close().catch(() => undefined);
    playCtxRef.current = null;
    chunkerRef.current = null;
    refWriteRef.current = 0;
    refReadRef.current = 0;
  }, [stopPlayback]);

  // ---- 开始 / 结束通话 ----
  const startCall = useCallback(async (mode: "conversation" | "dictation" = "conversation") => {
    setNotice("");
    // 听写只转文字进 composer，不需要已有会话；正常语音通话仍要求绑定会话。
    if (mode === "conversation" && !threadId) {
      setNotice("请先打开一个会话，再开始语音通话");
      setExpanded(true);
      return;
    }
    if (models && !models.ready) {
      setNotice(`语音模型尚未下载完整（${models.readyFiles}/${models.totalFiles}），请先点下方「下载模型」`);
      setExpanded(true);
      return;
    }
    voiceModeRef.current = mode;
    setPhase("starting");
    try {
      const started = await window.codex.voiceStart(threadId || "", { mode });
      if (!started?.ok) throw new Error(started?.error || "语音引擎启动失败");
      await startCapture();
      setPhase("active");
      // 输入框听写不弹右下角通话面板；只显示 composer 上方实时字幕。
      setExpanded(mode === "conversation");
      setUserText("");
      setAgentText("");
      agentTextRef.current = "";
      // 通知输入框上方的舞台：通话/听写开始（波浪 + 中文字幕由此显示）
      patchVoiceStage({ active: true, mode: "listening", level: 0, userText: "", agentText: "", dictating: mode === "dictation" });
    } catch (error: any) {
      setPhase("idle");
      await teardown();
      await window.codex.voiceStop().catch(() => undefined);
      setNotice(String(error?.message ?? error));
      setExpanded(true);
    }
  }, [threadId, models, startCapture, teardown]);

  const endCall = useCallback(async () => {
    setPhase("idle");
    voiceModeRef.current = "conversation";
    await teardown();
    await window.codex.voiceStop().catch(() => undefined);
    setState("listening");
    setLevel(0);
    ballRef.current?.style.setProperty("--voice-level", "0");
    setExpanded(false);
    // 波浪/字幕随之收起
    resetVoiceStage();
  }, [teardown]);

  // 波浪舞台上的「结束通话」按钮调的是这里（注册进 store，跨组件调用）
  useEffect(() => {
    setVoiceStopHandler(() => { void endCall(); });
    return () => setVoiceStopHandler(null);
  }, [endCall]);

  // composer 发送键旁的麦克风：启动/停止「只转文字、不自动发送」的听写模式。
  useEffect(() => {
    setVoiceDictationHandler((request) => {
      const active = phaseRef.current === "active" || phaseRef.current === "starting";
      const action = request?.action ?? "toggle";
      if (action === "start") {
        if (!active) void startCall("dictation");
        return;
      }
      if (action === "stop") {
        if (!active) return;
        void (async () => {
          // 先 flush ASR 尾句，再停 worker；否则松手时最后几个字还没命中 endpoint 会丢。
          if (voiceModeRef.current === "dictation") await window.codex.voiceDictationFinish().catch(() => undefined);
          await endCall();
          // final 字幕更新 prompt 是 React state；下一帧再发，避免 send() 读到旧 prompt。
          if (request?.send) window.setTimeout(() => requestVoiceDictationSend(), 120);
        })();
        return;
      }
      if (active) void endCall();
      else void startCall("dictation");
    });
    return () => setVoiceDictationHandler(null);
  }, [endCall, startCall]);

  // ── 按键启动：全局快捷键（应用没聚焦也能唤起）→ 切换通话 ──
  useEffect(() => {
    const off = window.codex.onVoiceHotkey(() => {
      if (phaseRef.current === "active" || phaseRef.current === "starting") void endCall();
      else void startCall();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 语音唤醒：持续聆听 + 匹配唤醒词（会常驻占用 CPU，默认关）──
  useEffect(() => {
    // 通话中/启动中不跑唤醒（避免抢麦克风与 CPU）
    if (phase === "active" || phase === "starting") return;
    let disposed = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let node: AudioWorkletNode | null = null;
    let blobUrl = "";

    (async () => {
      const s = await window.codex.voiceSettingsGet().catch(() => null);
      const wake = s?.settings?.wake;
      if (disposed || !wake?.enabled || !wake.phrase) return;
      const started = await window.codex.voiceWakeStart().catch(() => ({ ok: false }));
      if (disposed || !started?.ok) return;

      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      if (disposed) { stream.getTracks().forEach((t) => t.stop()); return; }
      ctx = new AudioContext({ sampleRate: CAPTURE_RATE });
      blobUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: "text/javascript" }));
      await ctx.audioWorklet.addModule(blobUrl);
      if (disposed) return;
      node = new AudioWorkletNode(ctx, "voice-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      node.port.onmessage = (e: MessageEvent) => {
        const raw = e.data?.samples as Float32Array | undefined;
        if (!raw || disposed) return;
        void window.codex.voiceWakeAudio(raw).then((r) => {
          const text = String(r?.text ?? "");
          if (!text) return;
          // 归一化后再匹配：去掉空白与常见标点（识别结果常带空格/句号）
          const norm = text.replace(/[\s，。！？、,.!?~]/g, "");
          if (norm.includes(wake.phrase)) {
            void window.codex.voiceWakeReset();
            void startCall();
          }
        }).catch(() => undefined);
      };
      const src = ctx.createMediaStreamSource(stream);
      src.connect(node);
      node.connect(ctx.destination);
    })().catch(() => undefined);

    return () => {
      disposed = true;
      try { node?.disconnect(); } catch { /* 已断开 */ }
      void ctx?.close().catch(() => undefined);
      stream?.getTracks().forEach((t) => t.stop());
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      void window.codex.voiceWakeStop().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // 卸载时务必释放麦克风与音频上下文（不留后台采集）
  useEffect(() => {
    return () => {
      void teardown();
      void window.codex.voiceStop().catch(() => undefined);
    };
  }, [teardown]);

  const installModels = useCallback(async () => {
    setNotice("");
    setDownload({ percent: 0, message: "准备下载…" });
    try {
      const result = await window.codex.voiceModelsInstall();
      if (!result?.ok) setNotice(result?.error || "模型下载未完成，可稍后重试（支持断点续传）");
      else setNotice("");
    } catch (error: any) {
      setNotice(String(error?.message ?? error));
    } finally {
      setDownload(null);
      await refreshModels();
    }
  }, [refreshModels]);

  // ---- 拖动悬浮球 ----
  // 分工：pointer 事件只负责「拖动」，动作一律交给 onClick。
  // 这样键盘 Enter/Space、以及自动化里的 el.click() 都能触发（否则只有真鼠标能用）。
  const draggedRef = useRef(false);
  const onPointerDown = (event: React.PointerEvent) => {
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    dragRef.current = { dx: event.clientX, dy: event.clientY, moved: false };
    draggedRef.current = false;
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const movedX = event.clientX - drag.dx;
    const movedY = event.clientY - drag.dy;
    if (!drag.moved && Math.abs(movedX) + Math.abs(movedY) < 4) return;
    drag.moved = true;
    drag.dx = event.clientX;
    drag.dy = event.clientY;
    setPos((prev) => {
      const next = {
        right: Math.min(Math.max(8, prev.right - movedX), Math.max(8, window.innerWidth - 64)),
        bottom: Math.min(Math.max(8, prev.bottom - movedY), Math.max(8, window.innerHeight - 64)),
      };
      return next;
    });
  };
  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) {
      draggedRef.current = true; // 抑制紧随其后的 click（拖动不该被当成点击）
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(pos));
      } catch {
        /* 存不进去无所谓 */
      }
    }
  };
  const onBallClick = () => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (phaseRef.current === "active") setExpanded((prev) => !prev);
    else void startCall();
  };

  const stateLabel =
    phase === "starting"
      ? "正在启动…"
      : state === "listening"
        ? "聆听中"
        : state === "thinking"
          ? "思考中"
          : "播报中";

  const modelsReady = models?.ready ?? false;
  const ballClass = `voice-ball ${phase === "active" ? `is-${state}` : ""} ${phase === "starting" ? "is-starting" : ""}`;

  return createPortal(
    <div className="voice-float-layer" style={{ right: pos.right, bottom: pos.bottom }}>
      {expanded && (
        <div className="voice-panel" role="dialog" aria-label="语音通话">
          <header className="voice-panel-head">
            <span className={`voice-dot is-${phase === "active" ? state : "idle"}`} />
            <strong>{phase === "active" ? stateLabel : "语音通话"}</strong>
            <button className="voice-icon-btn" title="收起" onClick={() => setExpanded(false)}>
              <X size={14} />
            </button>
          </header>

          {phase === "active" ? (
            <>
              <div className="voice-level" aria-hidden>
                {Array.from({ length: 22 }).map((_, index) => {
                  const threshold = (index % 11) / 11;
                  const on = level > threshold * 0.9;
                  return <i key={index} className={on ? "on" : ""} style={{ height: `${6 + (index % 6) * 3}px` }} />;
                })}
              </div>
              <div className="voice-caption">
                <div className="voice-caption-row">
                  <span className="voice-caption-tag">你说</span>
                  <p>{userText || "…"}</p>
                </div>
                <div className="voice-caption-row agent">
                  <span className="voice-caption-tag">回复</span>
                  <p>{agentText || "…"}</p>
                </div>
              </div>
              <div className="voice-panel-actions">
                <button
                  className="voice-secondary"
                  onClick={() => {
                    stopPlayback();
                    void window.codex.voiceBarge().catch(() => undefined);
                  }}
                >
                  <AudioLines size={14} />打断
                </button>
                <button className="voice-danger" onClick={() => void endCall()}>
                  <PhoneOff size={14} />挂断
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="voice-hint">
                点一下麦克风开始通话：本机离线识别，开口即可打断。原有打字输入完全不受影响。
              </p>
              <div className="voice-models">
                {models ? (
                  modelsReady ? (
                    <span className="voice-models-ok">语音模型已就绪（{formatBytes(models.bytes)}）</span>
                  ) : (
                    <span className="voice-models-missing">
                      语音模型未下载（{models.readyFiles}/{models.totalFiles}，约 270MB）
                    </span>
                  )
                ) : (
                  <span className="voice-models-missing">无法读取模型状态</span>
                )}
              </div>
              {download && (
                <div className="voice-progress">
                  <div className="voice-progress-bar">
                    <span style={{ width: `${download.percent >= 0 ? download.percent : 5}%` }} />
                  </div>
                  <small>{download.message}</small>
                </div>
              )}
              <div className="voice-panel-actions">
                {!modelsReady && (
                  download ? (
                    <button className="voice-secondary" onClick={() => void window.codex.voiceModelsCancel()}>
                      <X size={14} />取消下载
                    </button>
                  ) : (
                    <button className="voice-secondary" onClick={() => void installModels()}>
                      <Download size={14} />下载模型
                    </button>
                  )
                )}
                <button className="voice-primary" disabled={phase === "starting"} onClick={() => void startCall()}>
                  {phase === "starting" ? <LoaderCircle size={14} className="spin" /> : <Mic size={14} />}开始通话
                </button>
              </div>
            </>
          )}

          {notice && (
            <div className="voice-notice">
              <AlertCircle size={13} />
              <span>{notice}</span>
            </div>
          )}
        </div>
      )}

      {ballVisible && (
        <>
          {/* 随机短提示气泡 */}
          {hint && <div className="voice-hint-bubble" role="status">{hint}</div>}

          <button
            ref={ballRef}
            className={ballClass}
            title={phase === "active" ? "语音通话进行中（点击展开/收起，右键更多）" : "语音通话（本机离线，右键更多）"}
            aria-label={phase === "active" ? "语音通话进行中" : "开始语音通话"}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={onBallClick}
            onContextMenu={onBallContextMenu}
          >
            {/* 两圈脉冲环（错开动画，音量越大扩散越远） */}
            <span className="voice-ball-ring" aria-hidden />
            <span className="voice-ball-ring" aria-hidden />
            {/* 启动中也始终保留语音 logo：之前用 LoaderCircle 直接替换 logo，
                但 button 本身 color:transparent，导致点击后整颗球像"透明消失"。 */}
            <VoiceMascot
              mode={phase === "starting" ? "thinking" : phase === "active" ? (state as "listening" | "thinking" | "speaking") : "idle"}
              size={34}
            />
            {phase === "starting" && (
              <span className="voice-ball-loading" aria-label="语音正在启动">
                <LoaderCircle size={19} className="spin" />
              </span>
            )}
          </button>

          {/* 右键菜单：隐藏 / 跳转到语音设置 */}
          {menu && (
            <div
              className="voice-ball-menu"
              style={{ left: menu.x, top: menu.y }}
              role="menu"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => { setMenu(null); requestVoiceOpenSettings(); }}
              >
                <Settings2 size={13} />语音设置
              </button>
              <button type="button" role="menuitem" onClick={hideBall}>
                <EyeOff size={13} />隐藏悬浮球
              </button>
            </div>
          )}
        </>
      )}
    </div>,
    document.body
  );
}
