/**
 * useVoiceAnnounce —— 「语音播报」的执行端（10-08 新增板块，10-09 两轮重写）。
 *
 * 用户需求演进：
 *   · 10-08：「新增两个播报功能：一是运行过程中的正文实时播报，二是运行结束后对最终消息进行汇总播报」，
 *            作用范围 = 通话中 + 非通话（用户明确选了「两者都要」）；
 *   · 10-09 第一轮：「语气过于平淡 → 改成让 Codex 根据上下文自行决定并生成播报内容」
 *            「增加播报进行中的实时反馈」「支持随时停止」「记得配套对应工具，没工具他调用不了」；
 *   · 10-09 第二轮（**本版**）：「运行的正文和汇总正文不用播报了，只播报 Codex 写的内容」
 *            ⇒ 非通话链路里**删掉**「正文流式逐句念」与「本机压缩摘要」两条来源，
 *              只念模型写在回复末尾的 `voice` 播报稿（+ 它主动插播的那句话）。
 *
 * ── 职责划分（⛔ 这条边界是本功能的核心，别越界）────────────────────────────────
 *   · **通话中**：播报由 `VoiceCallFloat` 自己的链路负责（它还要喂 AEC 参考环、走音量/世代号/打断
 *     那一套）。本 hook 读 `getVoiceStage().active` **主动避让**，否则会出现两个播报器同时念。
 *     自己也无法插话 —— 这就是为什么 `voice_announce` 工具在主进程那一侧被通话状态拒绝。
 *   · **非通话**：本 hook 接管 —— 合成走 `voice:preview-voice`（主进程有常驻试听 worker，
 *     不必在通话中也能合成；`voice:speak` 那条只在通话里有 worker），播放走本模块自己的
 *     AudioContext 队列。**不开麦克风**（只听不说）。
 *
 * ── 念什么（10-09 第二轮定稿）────────────────────────────────────────────────
 *   ① **播报稿**：模型在回复末尾写的 `voice` 围栏块（契约见 `src/lib/voice-script.mjs`），
 *      回合结束时念一次；**它没写就什么都不念**（不再回退到本机压缩摘要）。
 *   ② **主动插播**：模型调 `voice_announce` 工具（主进程广播 harness:event）⇒ 立即念，
 *      ⛔ **不看开关**（显式调用就是用户要听这一句）。
 *   ⛔ 正文（流式 delta）**一律不念** —— 那条链整个删除了，不是"换个开关"。
 *
 * ── 同回合去重（10-09 用户报「同一段内容重复播放好几次」）──────────────────────
 *   两条入口（工具插播 / 结束播报稿）可能送来同一段内容。裁决点在 `speak()`：**逐句**查重
 *   （`dedupeSpokenSentences`），同一句话在同回合只念第一遍；回合结束/被打断整表清零 ⇒
 *   跨回合「再说一遍」不受影响。详见 `spokenKeysRef` 注释。
 *
 * ⛔ 语速/音色/音量取的都是**设置里的值**（不在这里另存一份）—— 单一真相源。
 * ⛔ 事件源是 `announce-bus`（由事件路由在**当前会话**上转发），不在本模块里解析引擎事件。
 */
import { useCallback, useEffect, useRef } from "react";
import { createSpeakFilter } from "../../lib/speak-text.mjs";
import { dedupeSpokenSentences, resolveAnnounceSummary } from "../../lib/voice-script.mjs";
import {
  notifyAnnounceToggle,
  publishAnnounceEvent,
  publishAnnounceStatus,
  setAnnounceNoticeHandler,
  setAnnounceStopHandler,
  subscribeAnnounce,
  IDLE_ANNOUNCE_STATUS,
  type AnnounceStatus,
} from "../../voice/announce-bus";
import { decodeFloat32Base64 } from "../../voice/audio-transport";
import { getVoiceStage, subscribeVoiceStage } from "../../voice/wave-level";

type AnnounceCfg = { enabled: boolean; volume: number };

/** 排队上限（段数）。超过就**不再为这一句合成**（丢弃它，保持跟手）。 */
const MAX_ANNOUNCE_BACKLOG = 4;

export function useVoiceAnnounce(threadId: string = ""): void {
  /** 开关/音量（从设置读、经 voice:event 广播刷新；放 ref 里避免每次变化重建订阅） */
  const cfgRef = useRef<AnnounceCfg>({ enabled: true, volume: 1 });
  const ctxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<AudioBufferSourceNode[]>([]);
  /** 世代号：回合结束/新一轮开始时 +1，让「已经在 TTS 里合成中」的那半句回来时被丢弃 */
  const epochRef = useRef(0);
  /** 状态栏要显示「来源」：这一轮是结束播报稿 / 还是模型主动插播 */
  const sourceRef = useRef<AnnounceStatus["source"]>("");
  /** 还有多少句在「合成中/排队合成」（不含已经排进 AudioContext 的那些） */
  const busyRef = useRef(0);
  /** 是否刚被掐断过（状态栏显示「已停止」再自动收起，由下一次开播复位） */
  const stoppedRef = useRef(false);
  const stoppedTimerRef = useRef(0);
  /**
   * 同一回合内的「已播出」登记表（10-09 用户报「同一段音频连续播放两次 / 好几次」后加）。
   *
   * ⛔ 根因（两轮）：同一段内容有**两条互不知情的入口** —— ① `voice_announce` 工具插播；
   *    ② 回合末尾的播报稿。两条链最终都汇入同一个 `speak()`，而 speak 此前按**整段文本**查重 ——
   *    可两条入口喂进来的切分粒度不同（工具整段 / 播报稿整段，但正文链当时是逐句）⇒
   *    整段键对不上，同一句被念好几遍。现在由 `dedupeSpokenSentences` **逐句**算键、逐句登记。
   * ⛔ 键的算法 = `spokenDedupeKey`（只留字母/数字，忽略标点空白大小写）。
   *    命中即跳过（连合成的钱都省）；合成成功后才登记。**回合结束（含被打断）整表清零** ——
   *    跨回合的「再说一遍」是新请求，必须照念，绝不能被误吞。
   * ⛔ 为什么登记在合成成功之后而不是入口：入口登的话，先到的那句合成失败（模型没下载），
   *    后到的兜底句也会被吞 ⇒ 用户一个字都听不到。
   */
  const spokenKeysRef = useRef<Set<string>>(new Set());
  const clearSpokenKeys = useCallback(() => { spokenKeysRef.current.clear(); }, []);
  /**
   * 串行链（自行 code review 补的一处真缺陷）。
   *
   * ⛔ 合成是 async 的，多个 speak 会并发到达。不串行的话：A 句的合成慢一点、B 句的快一点 ⇒
   *    B 先入队 ⇒ **念出来的顺序与正文顺序不一致**（用户听到的是打乱的话）。
   *    做法：所有会「产出音频」的动作依次挂到同一条链上；`stopPlayback` **不进链**
   *    （它必须立刻生效，否则「停止播报」会被排到几分钟后的队尾）。
   */
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const enqueueTask = useCallback((task: () => Promise<void>) => {
    chainRef.current = chainRef.current.then(task).catch(() => undefined);
  }, []);

  /** 把当前的真实状况推给状态栏（唯一出口：凡是会改变「看起来在不在念」的地方都要调它） */
  const publishStatus = useCallback(() => {
    const first: any = queueRef.current[0];
    const active = Boolean(first) || busyRef.current > 0;
    publishAnnounceStatus({
      active,
      current: String(first?.__text ?? ""),
      pending: Math.max(0, queueRef.current.length - 1),
      source: active ? sourceRef.current : "",
      stopped: !active && stoppedRef.current,
    });
  }, []);

  const stopPlayback = useCallback((byUser = false) => {
    epochRef.current += 1;
    for (const source of queueRef.current) {
      try { source.stop(); } catch { /* 已经播完 */ }
    }
    queueRef.current = [];
    sourceRef.current = "";
    if (byUser) {
      stoppedRef.current = true;
      /* ⛔ 「已停止」只是一句**回执**，不是常驻状态：留着不动的话状态条会永远挂在输入框上。
         给个短暂停留让用户看见自己按的那一下生效了，然后自动收起。 */
      if (stoppedTimerRef.current) clearTimeout(stoppedTimerRef.current);
      stoppedTimerRef.current = window.setTimeout(() => {
        stoppedRef.current = false;
        stoppedTimerRef.current = 0;
        publishStatus();
      }, 1600);
    }
    publishStatus();
  }, [publishStatus]);

  const ensureCtx = useCallback((): AudioContext => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    return ctxRef.current;
  }, []);

  /** 排队播放（顺序播：接在最后一个的结束时刻之后） */
  const play = useCallback(async (samples: Float32Array, sampleRate: number, epoch: number, text = "") => {
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
    (source as any).__text = text;
    queueRef.current.push(source);
    source.onended = () => {
      queueRef.current = queueRef.current.filter((item) => item !== source);
      publishStatus();
    };
    source.start(startAt);
    publishStatus();
  }, [ensureCtx, publishStatus]);

  /** 合成一句并排队：非通话路径走 preview-voice（常驻试听 worker） */
  const speak = useCallback(async (text: string, epoch: number, opts: { speed?: number } = {}) => {
    const clean = String(text ?? "").trim();
    if (!clean) return;
    // 背压：排太长就丢弃这一句（保持跟手，不变成停不下来的复读机）
    if (queueRef.current.length >= MAX_ANNOUNCE_BACKLOG) {
      console.warn("[voice-announce] 播报排队过长，丢弃这一句以保持跟手：", clean.slice(0, 24));
      return;
    }
    // ⛔ 同回合去重（**句子级**）：两条入口（工具插播 / 结束播报稿）喂进来的文本切分粒度可能不同，
    //    只按整段比键会漏判 ⇒ 同一句被念好几遍（10-09 用户报的「重复播放好几次」）。按句切开后统一对齐。
    const deduped = dedupeSpokenSentences(clean, spokenKeysRef.current);
    if (!deduped.text) {
      console.warn("[voice-announce] 同一回合内这段内容已经播报过，跳过重复播放：", clean.slice(0, 24));
      return;
    }
    busyRef.current += 1;
    publishStatus();
    try {
      const result: any = await window.codex.voicePreviewVoice({ text: deduped.text, speed: opts.speed }).catch(() => null);
      if (epoch !== epochRef.current) return;   // 期间被打断/换轮：这句不念
      if (!result?.ok || !result.audioBase64 || !result.sampleRate) {
        // ⛔ 不静默吞：模型没下全 / worker 起不来时，用户会「开了播报却没声音」，日志是唯一线索
        console.warn("[voice-announce] 合成失败：", result?.error ?? "未知错误");
        return;
      }
      const samples = decodeFloat32Base64(result.audioBase64);
      if (samples.length) {
        // ⛔ 登记必须放在「确认会出声」之后：合成失败不登记，后到的兜底句才不会被误吞
        for (const key of deduped.keys) spokenKeysRef.current.add(key);
        await play(samples, Number(result.sampleRate), epoch, deduped.text);
      }
    } finally {
      busyRef.current = Math.max(0, busyRef.current - 1);
      publishStatus();
    }
  }, [play, publishStatus]);

  /**
   * 回合结束：**只念模型写的播报稿**（10-09 第二轮：不再念正文、不再念本机压缩摘要）。
   * ⛔ 唯一裁决点是 `resolveAnnounceSummary`（src/lib/voice-script.mjs）；它没写稿就返回空串，
   *    这里**什么都不念** —— 别在这里补任何兜底文案（那正是用户要删掉的"汇总正文"）。
   */
  const finishTurn = useCallback(async (finalText: string) => {
    if (!cfgRef.current.enabled) return;
    sourceRef.current = "summary";
    const script = resolveAnnounceSummary(String(finalText ?? ""));
    if (script.text) await speak(script.text, epochRef.current);
  }, [speak]);

  /** 模型主动插播（`voice_announce` 工具）：⛔ 不看开关 —— 显式调用就是用户想听这一句 */
  const speakNow = useCallback(async (text: string, speed?: number) => {
    sourceRef.current = "tool";
    stoppedRef.current = false;
    const epoch = epochRef.current;
    /* ⛔ 工具文本也要过**同一套朗读清洗**（数字中文化 / markdown 剥除）：一来工具原文里的
       记号不会被当字念出来，二来去重键必须与播报稿链同源 —— 两条入口的字面差异（标点/写法）
       不过同一套滤就永远对不上（去重失效 = 白修）。 */
    const filter = createSpeakFilter();
    const spoken = String(filter.push(String(text ?? "")) ?? "").trim();
    await speak(spoken, epoch, { speed });
  }, [speak]);

  // ── 设置：挂载读一次 + 主进程保存时广播刷新（与悬浮球/唤醒同一套）──
  useEffect(() => {
    let alive = true;
    /* ⛔ `prevRef` = 上一次**已知**的开关状态，初值为 null ⇒ 首次读到设置**不发**告知
       （否则每次开窗口/刷新都会往会话里塞一条「语音播报已开启」，用户什么都没干却被告知）。 */
    let prev: boolean | null = null;
    const applySettings = (raw: any) => {
      if (!raw) return;
      const a: any = raw.announce ?? {};
      // 兼容旧形状 {live, summary}（渲染层被单独 reload / 主进程未重启时可能读到）：
      // 判据与主进程迁移同源 —— 任一为真即视为开着。
      const enabled = typeof a.enabled === "boolean"
        ? a.enabled
        : (a.live !== false || a.summary === true);
      cfgRef.current = {
        enabled,
        volume: typeof raw.tts?.volume === "number" ? raw.tts.volume : cfgRef.current.volume,
      };
      if (prev !== null && prev !== enabled) notifyAnnounceToggle(enabled);
      prev = enabled;
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
      if (event.type === "toolSpeak") {
        /* ⛔ 会话闸：`harness:event` 是**全窗口广播**，而这个 app 可以有多个窗口/多个会话。
           不比对 ⇒ 另一个窗口里那条群的插播会在当前窗口一起念出来（跨场合念 = 听起来像见鬼）。 */
        if (threadId && event.threadId && event.threadId !== threadId) return;
        stoppedRef.current = false;
        enqueueTask(() => speakNow(event.text, event.speed));
        return;
      }
      if (event.type === "turnDone") {
        /* ⛔ 被打断的回合：**别再念了** —— 与通话链路一致（那里 bumpSpeechEpoch + 不 flush 断句器）。
           ⛔ 去重登记表是**回合级**的：收尾（含播报稿）也要参与本回合查重，所以清表必须
              排在 finishTurn **之后** —— 放这里同步清的话，播报稿里的重复句就拦不住了。 */
        if (event.aborted) { epochRef.current += 1; clearSpokenKeys(); publishStatus(); return; }
        if (!cfgRef.current.enabled) { clearSpokenKeys(); return; }
        enqueueTask(() => finishTurn(event.text).finally(clearSpokenKeys));
      }
    });
    return off;
  }, [clearSpokenKeys, enqueueTask, finishTurn, publishStatus, speakNow, threadId]);

  /* ── `voice_announce` / `voice_announce_stop` 工具（主进程 dispatch-rpc 广播）────────
     为什么在**这里**收而不是新建一个组件：执行端本来就在这（队列 + AudioContext 只有一份），
     再开一个订阅者会出现两套播放队列。走 `harness:event` ⇒ 不需要新 IPC 通道。
     ⛔ 这里只做**翻译**（把广播翻成总线事件），不管说话 —— 「该不该念、避不避让、要不要进串行链」
        全在总线订阅那一处（两处各判一半就是本项目记过的「二房东」缺陷：改了这边漏那边）。 */
  useEffect(() => {
    const off = window.codex.onHarnessEvent((payload: any) => {
      if (!payload || payload.type !== "voice-announce") return;
      const target = String(payload.threadId ?? "");
      if (threadId && target && target !== threadId) return;   // 会话闸：别的会话的插播不许在这里念
      if (payload.action === "stop") { stopPlayback(true); return; }
      const text = String(payload.text ?? "").trim();
      if (!text) return;
      const speed = Number(payload.speed);
      publishAnnounceEvent({
        type: "toolSpeak",
        threadId: target,
        text,
        speed: Number.isFinite(speed) && speed > 0 ? speed : undefined,
      });
    });
    return () => { off?.(); };
  }, [stopPlayback, threadId]);

  // 「停止播报」出口（状态栏 / 悬浮球右键菜单）：非通话播报不开麦、界面很小，
  // 没有这个出口用户就只能等它念完 —— 与 wave-level 的结束通话/打断同一套广播注册。
  useEffect(() => {
    setAnnounceStopHandler(() => { stopPlayback(true); });
    // 通话一开始就停掉独立播报：否则通话的播报与这里排队的音频会同时出声
    const offStage = subscribeVoiceStage((stage) => { if (stage.active) stopPlayback(); });
    return () => { setAnnounceStopHandler(null); offStage(); };
  }, [stopPlayback]);

  // 卸载：释放音频上下文（不留后台播放）
  useEffect(() => () => {
    if (stoppedTimerRef.current) clearTimeout(stoppedTimerRef.current);
    epochRef.current += 1;
    publishAnnounceStatus(IDLE_ANNOUNCE_STATUS);
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
  }, []);
}
