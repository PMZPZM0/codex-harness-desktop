/**
 * useVoiceAnnounce —— 「语音播报」的执行端（10-08 新增板块）。
 *
 * 用户需求：「新增两个播报功能：一是运行过程中的正文实时播报，二是运行结束后对最终消息进行汇总播报」，
 * 作用范围 = **通话中 + 非通话**（用户明确选了「两者都要」）。
 *
 * ── 职责划分（⛔ 这条边界是本功能的核心，别越界）────────────────────────────────
 *   · **通话中**：播报由 `VoiceCallFloat` 自己的链路负责（它还要喂 AEC 参考环、走音量/世代号/打断
 *     那一套）。本 hook 读 `getVoiceStage().active` **主动避让**，否则会出现两个播报器同时念。
 *   · **非通话**：本 hook 接管 —— 合成走 `voice:preview-voice`（主进程有常驻试听 worker，
 *     不必在通话中也能合成；`voice:speak` 那条只在通话里有 worker），播放走本模块自己的
 *     AudioContext 队列。**不开麦克风**（只听不说）。
 *
 * ── 两个开关（settings.announce，主进程读写，改完经 voice:event 广播即时生效）──
 *   · live    正文流式生成时逐句念（断句器 + 朗读视图清洗，与通话同一套基座函数）；
 *   · summary 回合结束时念一段**本机压缩**出来的要点（src/lib/voice-summary.mjs）。
 *
 * ⛔ 语速/音色/音量取的都是**设置里的值**（不在这里另存一份）—— 单一真相源。
 * ⛔ 事件源是 `announce-bus`（由事件路由在**当前会话**上转发），不在本模块里解析引擎事件。
 */
import { useCallback, useEffect, useRef } from "react";
import { createSentenceChunker } from "../../lib/voice-aec.mjs";
import { createSpeakFilter } from "../../lib/speak-text.mjs";
import { SUMMARY_EMPTY_NOTICE, summarizeForSpeech } from "../../lib/voice-summary.mjs";
import { subscribeAnnounce, setAnnounceStopHandler } from "../../voice/announce-bus";
import { decodeFloat32Base64 } from "../../voice/audio-transport";
import { getVoiceStage, subscribeVoiceStage } from "../../voice/wave-level";

type AnnounceCfg = { live: boolean; summary: boolean; volume: number };

/**
 * 排队上限（段数）。超过就**不再为这一句合成**（丢弃它，保持跟手）。
 *
 * ⛔ 为什么必须封顶：非通话播报是「只听」链路，合成一句要几百毫秒、播一句要几秒，
 *    正文持续输出时队列会越排越长 —— 用户会听到「几分钟前那段回复」。
 *    宁可丢中间内容，也不要变成停不下来的复读机（它同时还有悬浮球右键的「停止播报」可断）。
 */
const MAX_ANNOUNCE_BACKLOG = 4;

export function useVoiceAnnounce(): void {
  /** 开关/音量（从设置读、经 voice:event 广播刷新；放 ref 里避免每次变化重建订阅） */
  const cfgRef = useRef<AnnounceCfg>({ live: true, summary: false, volume: 1 });
  const chunkerRef = useRef<any>(null);
  const filterRef = useRef<any>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<AudioBufferSourceNode[]>([]);
  /** 世代号：回合结束/新一轮开始时 +1，让「已经在 TTS 里合成中」的那半句回来时被丢弃 */
  const epochRef = useRef(0);

  const resetChunker = useCallback(() => {
    chunkerRef.current = null;
    filterRef.current = null;
  }, []);

  /** 停掉排队中的播报（挂断/新一轮/卸载时用；不是必须，但避免积压念完旧内容） */
  const stopPlayback = useCallback(() => {
    epochRef.current += 1;
    for (const source of queueRef.current) {
      try { source.stop(); } catch { /* 已经播完 */ }
    }
    queueRef.current = [];
    resetChunker();
  }, [resetChunker]);

  const ensureCtx = useCallback((): AudioContext => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    return ctxRef.current;
  }, []);

  /** 排队播放（顺序播：接在最后一个的结束时刻之后） */
  const play = useCallback(async (samples: Float32Array, sampleRate: number, epoch: number) => {
    if (epoch !== epochRef.current) return;
    const ctx = ensureCtx();
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    if (epoch !== epochRef.current) return;
    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    // copyToChannel 要求底层是 ArrayBuffer（跨 IPC 回来的可能是 ArrayBufferLike），拷一份最稳
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = cfgRef.current.volume;
    source.connect(gain);
    gain.connect(ctx.destination);
    const last: any = queueRef.current[queueRef.current.length - 1];
    const startAt = last ? Math.max(ctx.currentTime, last.__endsAt ?? 0) : ctx.currentTime;
    (source as any).__endsAt = startAt + buffer.duration;
    queueRef.current.push(source);
    source.onended = () => {
      queueRef.current = queueRef.current.filter((item) => item !== source);
    };
    source.start(startAt);
  }, [ensureCtx]);

  /** 合成一句并排队：非通话路径走 preview-voice（常驻试听 worker） */
  const speak = useCallback(async (text: string, epoch: number) => {
    const clean = String(text ?? "").trim();
    if (!clean) return;
    // 背压：排太长就丢弃这一句（保持跟手，不变成停不下来的复读机）
    if (queueRef.current.length >= MAX_ANNOUNCE_BACKLOG) {
      console.warn("[voice-announce] 播报排队过长，丢弃这一句以保持跟手：", clean.slice(0, 24));
      return;
    }
    const result: any = await window.codex.voicePreviewVoice({ text: clean }).catch(() => null);
    if (epoch !== epochRef.current) return;   // 期间被打断/换轮：这句不念
    if (!result?.ok || !result.audioBase64 || !result.sampleRate) {
      // ⛔ 不静默吞：模型没下全 / worker 起不来时，用户会「开了播报却没声音」，日志是唯一线索
      console.warn("[voice-announce] 合成失败：", result?.error ?? "未知错误");
      return;
    }
    const samples = decodeFloat32Base64(result.audioBase64);
    if (samples.length) await play(samples, Number(result.sampleRate), epoch);
  }, [play]);

  /** 正文增量 → 断句 → 朗读视图清洗 → 逐句合成（与通话同一套基座函数，行为一致） */
  const feedDelta = useCallback(async (delta: string) => {
    if (!chunkerRef.current) chunkerRef.current = createSentenceChunker({ maxChars: 60 });
    if (!filterRef.current) filterRef.current = createSpeakFilter();
    const epoch = epochRef.current;
    const sentences: string[] = chunkerRef.current.push(delta);
    for (const sentence of sentences) {
      const spoken = filterRef.current.push(sentence);
      if (!spoken) continue;
      await speak(spoken, epoch);
      if (epoch !== epochRef.current) return;
    }
  }, [speak]);

  /** 回合结束：先把断句器里的尾句念完，再（若开了汇总）念要点 */
  const finishTurn = useCallback(async (finalText: string) => {
    const epoch = epochRef.current;
    const rest: string[] = chunkerRef.current?.flush() ?? [];
    if (!filterRef.current) filterRef.current = createSpeakFilter();
    for (const sentence of rest) {
      const spoken = filterRef.current?.push(sentence) ?? "";
      if (!spoken) continue;
      await speak(spoken, epoch);
      if (epoch !== epochRef.current) return;
    }
    resetChunker();
    if (!cfgRef.current.summary) return;
    const summary = summarizeForSpeech(String(finalText ?? ""));
    if (summary.text) await speak(summary.text, epoch);
    else if (summary.sentences === 0) await speak(SUMMARY_EMPTY_NOTICE, epoch);
  }, [resetChunker, speak]);

  // ── 设置：挂载读一次 + 主进程保存时广播刷新（与悬浮球/唤醒同一套）──
  useEffect(() => {
    let alive = true;
    const applySettings = (raw: any) => {
      if (!raw) return;
      const a = raw.announce ?? {};
      cfgRef.current = {
        live: a.live !== false,
        summary: a.summary === true,
        volume: typeof raw.tts?.volume === "number" ? raw.tts.volume : cfgRef.current.volume,
      };
    };
    void window.codex.voiceSettingsGet()
      .then((res: any) => { if (alive) applySettings(res?.settings); })
      .catch(() => undefined);
    const off = window.codex.onVoiceEvent((event: any) => {
      if (event?.type === "settings") applySettings(event.settings);
    });
    return () => { alive = false; off?.(); };
  }, []);

  // ── 事件源：播报总线（事件路由只在**当前会话**上转发）──
  useEffect(() => {
    const off = subscribeAnnounce((event) => {
      // 通话中由 VoiceCallFloat 播报（它有 AEC 参考环与打断链）⇒ 这里必须避让，否则两个播报器同时念
      if (getVoiceStage().active) return;
      if (event.type === "delta") {
        if (!cfgRef.current.live) return;
        void feedDelta(event.text);
        return;
      }
      if (event.type === "turnDone") {
        /* ⛔ 被打断的回合：**别再念了** —— 与通话链路一致（那里 bumpSpeechEpoch + 不 flush 断句器），
           半句停在原地，等用户的新话。⛔ 这里**不能**先调 stopPlayback 再走正常收尾：
           stopPlayback 会把断句器一起清掉，尾句就永远丢了（本项目「共享槽位两态」同型坑）。 */
        if (event.aborted) { stopPlayback(); return; }
        if (!cfgRef.current.live && !cfgRef.current.summary) { resetChunker(); return; }
        void finishTurn(event.text);
      }
    });
    return off;
  }, [feedDelta, finishTurn, resetChunker, stopPlayback]);

  // 「停止播报」出口（悬浮球右键菜单）：非通话播报不开麦、也没有自己的界面，
  // 没有这个出口用户就只能等它念完 —— 与 wave-level 的结束通话/打断同一套广播注册。
  useEffect(() => {
    setAnnounceStopHandler(() => { stopPlayback(); });
    // 通话一开始就停掉独立播报：否则通话的播报与这里排队的音频会同时出声
    const offStage = subscribeVoiceStage((stage) => { if (stage.active) stopPlayback(); });
    return () => { setAnnounceStopHandler(null); offStage(); };
  }, [stopPlayback]);

  // 卸载：释放音频上下文（不留后台播放）
  useEffect(() => () => {
    stopPlayback();
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
  }, [stopPlayback]);
}
