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

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, AudioLines, Download, LoaderCircle, Mic, PhoneOff, X } from "lucide-react";
import { createAec, createEchoGate, createSentenceChunker, resampleLinear, rmsOf } from "../lib/voice-aec.mjs";
import { CAPTURE_WORKLET_SOURCE } from "../voice/capture-worklet";

type VoicePhase = "idle" | "starting" | "active";
type VoiceState = "listening" | "thinking" | "speaking";

type ModelsStatus = { ready: boolean; missing: string[]; readyFiles: number; totalFiles: number; bytes: number };

const POS_KEY = "voice-float-pos";
const DEFAULT_POS = { right: 22, bottom: 104 };
const CAPTURE_RATE = 16000;
const BARGUE_COOLDOWN_MS = 1200;

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
  const gateRef = useRef<any>(null);
  const chunkerRef = useRef<any>(null);
  const refRingRef = useRef<Float32Array>(new Float32Array(CAPTURE_RATE * 2));
  const refWriteRef = useRef(0);
  const refReadRef = useRef(0);
  const lastBargeAtRef = useRef(0);
  const speakingRef = useRef(false);
  const phaseRef = useRef<VoicePhase>("idle");
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

  // ---- 主进程事件 ----
  useEffect(() => {
    const off = window.codex.onVoiceEvent((event: any) => {
      if (!event || typeof event !== "object") return;
      if (event.type === "state") {
        setState(event.state);
        return;
      }
      if (event.type === "partial") {
        setUserText(event.text);
        return;
      }
      if (event.type === "final") {
        setUserText(event.text);
        setAgentText("");
        return;
      }
      if (event.type === "delta") {
        setAgentText((prev) => prev + String(event.text ?? ""));
        void speakDelta(String(event.text ?? ""));
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
    source.connect(ctx.destination);

    // 把这段音频写进 AEC 参考环（重采样到采集率）
    pushRef(sampleRate === CAPTURE_RATE ? samples : resampleLinear(samples, sampleRate, CAPTURE_RATE));

    const last = playQueueRef.current[playQueueRef.current.length - 1];
    const startAt = last ? Math.max(ctx.currentTime, (last as any).__endsAt ?? 0) : ctx.currentTime;
    (source as any).__endsAt = startAt + buffer.duration;
    playQueueRef.current.push(source);
    playingCountRef.current += 1;
    speakingRef.current = true;
    source.onended = () => {
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
        if (!result?.ok || !result.samples || !result.sampleRate) {
          if (result && !result.ok && result.error) setNotice(result.error);
          continue;
        }
        await enqueuePlay(result.samples, result.sampleRate);
      }
    },
    [enqueuePlay]
  );

  const flushSpeech = useCallback(async () => {
    const rest: string[] = chunkerRef.current?.flush() ?? [];
    for (const sentence of rest) {
      const result = await window.codex.voiceSpeak(sentence).catch(() => null);
      if (result?.ok && result.samples && result.sampleRate) {
        await enqueuePlay(result.samples, result.sampleRate);
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
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    } catch (error: any) {
      // getUserMedia 报错名 → 人话 + 排查提示（开发工具里也能定位）
      const name = String(error?.name ?? "");
      const msg = String(error?.message ?? error);
      if (name === "NotFoundError" || /requested device not found/i.test(msg)) {
        throw new Error("未找到可用的麦克风设备（Requested device not found）。请检查：(1) 麦克风已物理接入并被系统识别；(2) 没有被其它程序独占（浏览器、Zoom、VoiceMeeter、OBS 等）；(3) Windows：在「设置 → 系统 → 声音」里能看到输入设备且没禁用；macOS：在「系统设置 → 隐私与安全 → 麦克风」授权本应用。");
      }
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new Error("麦克风权限被拒绝。请到系统的「麦克风隐私设置」里授权本应用，然后重试。");
      }
      if (name === "NotReadableError" || /in use/i.test(msg)) {
        throw new Error("麦克风正被其它程序独占（could not start audio source）。请关掉占用麦克风的应用再试。");
      }
      if (name === "OverconstrainedError") {
        throw new Error("请求的麦克风参数不被设备支持（OverconstrainedError）。通常是采样率/通道数不匹配。");
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
    const bargeMode = settings?.settings?.barge?.mode ?? "auto";
    const gateDb = settings?.settings?.barge?.gateDb ?? 6;
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
      setLevel(Math.min(1, rms * 12));

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
  const startCall = useCallback(async () => {
    setNotice("");
    if (!threadId) {
      setNotice("请先打开一个会话，再开始语音通话");
      setExpanded(true);
      return;
    }
    if (models && !models.ready) {
      setNotice(`语音模型尚未下载完整（${models.readyFiles}/${models.totalFiles}），请先点下方「下载模型」`);
      setExpanded(true);
      return;
    }
    setPhase("starting");
    try {
      const started = await window.codex.voiceStart(threadId);
      if (!started?.ok) throw new Error(started?.error || "语音引擎启动失败");
      await startCapture();
      setPhase("active");
      setExpanded(true);
      setUserText("");
      setAgentText("");
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
    await teardown();
    await window.codex.voiceStop().catch(() => undefined);
    setState("listening");
    setLevel(0);
    setExpanded(false);
  }, [teardown]);

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

      <button
        className={ballClass}
        title={phase === "active" ? "语音通话进行中（点击展开/收起）" : "语音通话（本机离线）"}
        aria-label={phase === "active" ? "语音通话进行中" : "开始语音通话"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onBallClick}
      >
        <span className="voice-ball-ring" aria-hidden />
        {phase === "starting" ? <LoaderCircle size={20} className="spin" /> : <Mic size={20} />}
      </button>
    </div>,
    document.body
  );
}
