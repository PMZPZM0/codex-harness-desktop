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
 * ── 念什么（10-09 第五轮定稿）────────────────────────────────────────────────
 *   ① **正文**（运行过程中逐句念）：两个入口，都只是把本回合标记成"念正文"——
 *      · **Codex 自己判断**（`voice_speak_reply` 工具）：用户在催、反复没做好、当前步骤重要、
 *        它自己有话要说时才会调；
 *      · **宿主硬规则兜底**（10-09 第六轮用户拍板）：单回合工具调用 **> 10 次**、
 *        或**同一个问题被返工 ≥2 次**（判据见 `src/lib/voice-auto-speak.mjs`）。
 *      用户把播报总开关关掉时正文也不念（比插播更"自动"，必须尊重开关）。
 *   ② **播报稿**：模型写在回复末尾的 `voice` 围栏块（契约见 `src/lib/voice-script.mjs`），
 *      回合结束时念一次；**它没写就什么都不念**（不回退到本机压缩摘要 —— 那条已删除）。
 *   ③ **主动插播**：模型调 `voice_announce`（≤80 字一句）⇒ 立即念，⛔ **不看开关**。
 *
 * ── 播报稿的合成分段（10-21 两次用户反馈的最终形态）────────────────────────────
 *   · 先为「播报延迟有点高」改成逐句合成、先到先播；
 *   · 随后用户报「连贯性好差，中间还要断一下」⇒ 播报稿改回**整段一次合成**。
 *     独立 utterance 的句末语调 + 句界硬拼 = 听感断开，负载高时还会露出合成空档。
 *     ⛔ 以后不要为了首句快再拆句；首句稍晚但整段连续，是用户明确选中的取舍。
 *
 * ── 同回合去重（10-09 用户报「同一段内容重复播放好几次」）──────────────────────
 *   三条入口（正文实时 / 工具插播 / 结束播报稿）可能送来同一段内容。裁决点在 `speak()`：
 *   **逐句**查重（`dedupeSpokenSentences`），同一句话在同回合只念第一遍；回合结束/被打断整表清零
 *   ⇒ 跨回合「再说一遍」不受影响。详见 `spokenKeysRef` 注释。
 *
 * ── 10-12 三条用户反馈的落点（本文件的判据都集中在这里，别在别处再判一遍）────
 *   ① 「停止都停止不了，一直播报」⇒ **静音闩锁**（`mutedRef`）：按停时同时清掉 `speakLiveRef`、
 *      `autoSpeakRef`，并在 `speak()` **唯一入口**拦下后续一切播报（正文 / 插播 / 播报稿）。
 *      解除只有两条路：状态条上的「恢复」按钮，或用户把总开关重新打开。
 *   ② 「不用这么长」⇒ **每回合 160 字预算**（`MAX_ANNOUNCE_CHARS_PER_TURN`，在 `speak()` 里扣）：
 *      队列长度背压管不住 `live` 那条无界正文流，必须按字数封顶；超了顺带关掉本回合正文朗读。
 *   ③ 「语音播报有点丑」⇒ 视觉整改在 `VoiceAnnounceIndicator.tsx` + `18-openai-dialog.css`。
 *
 * ⛔ 语速/音色/音量取的都是**设置里的值**（不在这里另存一份）—— 单一真相源。
 * ⛔ 事件源是 `announce-bus`（由事件路由在**当前会话**上转发），不在本模块里解析引擎事件。
 */
import { useCallback, useEffect, useRef } from "react";
import { createSentenceChunker } from "../../lib/voice-aec.mjs";
import { createSpeakFilter } from "../../lib/speak-text.mjs";
import { createVoiceScriptStripper, dedupeSpokenSentences, resolveAnnounceSummary } from "../../lib/voice-script.mjs";
import { createAutoSpeakTracker } from "../../lib/voice-auto-speak.mjs";
import {
  notifyAnnounceToggle,
  publishAnnounceEvent,
  publishAnnounceStatus,
  setAnnounceNoticeHandler,
  setAnnounceResumeHandler,
  setAnnounceStopHandler,
  subscribeAnnounce,
  IDLE_ANNOUNCE_STATUS,
  type AnnounceStatus,
} from "../../voice/announce-bus";
import { decodeFloat32Base64 } from "../../voice/audio-transport";
import { getVoiceStage, subscribeVoiceStage } from "../../voice/wave-level";

type AnnounceCfg = { enabled: boolean; volume: number };

/** 排队上限（段数）。超过就**不再为这一句合成**（丢弃它，保持跟手）。 */
const MAX_ANNOUNCE_BACKLOG = 3;

/**
 * 播报的 ZipVoice 采样步数（默认 4）。
 * ⛔ 10-21 用户报「播报延迟有点高」：实测 3.5 秒音频 4 步要 9.4 秒、2 步 4.8 秒（同机）。
 *    播报优先跟手，压到 2 步；设置页试听仍走默认 4 步，用户想对比音质时听试听。
 */
const ANNOUNCE_NUM_STEPS = 2;

/**
 * 本回合播报的**总量预算**（字符，10-12 用户：「这个语音播报，不用这么长」）。
 *
 * ⛔ 根因：在此之前只有「队列长度」背压（`MAX_ANNOUNCE_BACKLOG`），**没有总量上限** ——
 *    而 `live`（正文逐句念）是一条**无界流**：Codex 调一次 `voice_speak_reply`、或触发
 *    「工具调用 > 10 次 / 同一处返工 ≥2 次」硬规则之后，`speakLiveRef` 会一直为真，
 *    正文后续吐多少就念多少 ⇒ 一次长回合能被念一两分钟，且队列永远不满、背压形同虚设。
 *    这正是用户说的「一直播报」。
 * ⛔ 判据放在**唯一汇合处 `speak()`**：三条入口（正文实时 / 工具插播 / 结束播报稿）都过那里，
 *    在入口按字数扣预算 ⇒ 超了就直接丢弃这一句，**当回合剩下的内容一律不念**。
 * ⛔ 回合级清零（与 `spokenKeysRef` 同一时机）：预算不能跨回合累加，否则第二轮必然沉默。
 */
const MAX_ANNOUNCE_CHARS_PER_TURN = 160;

export function useVoiceAnnounce(threadId: string = ""): void {
  /** 开关/音量（从设置读、经 voice:event 广播刷新；放 ref 里避免每次变化重建订阅） */
  const cfgRef = useRef<AnnounceCfg>({ enabled: true, volume: 1 });
  /** 已预热的音色档案（null = 还没热过）；模型加载是播报延迟的大头，选好音色后先空合成一句短句把 worker 拉起来。 */
  const warmKeyRef = useRef<string | null>(null);
  /**
   * 「本回合要不要把正文边写边念」——⛔ **由 Codex 自己决定**（`voice_speak_reply` 工具，
   * 运行中广播 `voice-announce` / `action:"speak-reply"`）。不是每条回复都念，也不是用户开关控制：
   * 用户在催得急、反复没做好、当前步骤重要、或者它自己觉得有话要说这些情况下才会调。
   * 回合结束/被打断时复位（逐条生效，不会漏到下一轮）。
   */
  const speakLiveRef = useRef(false);
  /** 两条硬规则的累计器（每回合重置）——判据与阈值在 `src/lib/voice-auto-speak.mjs`（纯函数可真跑） */
  const autoSpeakRef = useRef<ReturnType<typeof createAutoSpeakTracker> | null>(null);
  const stripperRef = useRef<any>(null);
  const chunkerRef = useRef<any>(null);
  const filterRef = useRef<any>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<AudioBufferSourceNode[]>([]);
  /** 世代号：回合结束/新一轮开始时 +1，让「已经在 TTS 里合成中」的那半句回来时被丢弃 */
  const epochRef = useRef(0);
  /**
   * 静音闩锁（10-12 用户：「停止都停止不了，一直播报」）。
   *
   * ⛔⛔ **这是「停止」真正生效的地方**。此前的 `stopPlayback()` 只掐断了「此刻正在响的音频 +
   *   队列里已排好的」，但三条入口仍然活着：
   *     ① `speakLiveRef` 没被清 ⇒ 下一句正文 delta 到达，`feedDelta` 照旧合成照旧念；
   *     ② `autoSpeakRef` 没被 reset ⇒ 硬规则下一帧又命中，重新把本回合标成「念正文」；
   *     ③ 模型再调一次 `voice_announce` 插播工具 ⇒ `toolSpeak` 分支无条件入链。
   *   三条加起来的效果就是「点了停止它还在念」，而且模型越勤快插播越停不下来。
   * ⛔ 置位后由 **`speak()` 入口一处**拦下所有播报（正文实时 / 工具插播 / 结束播报稿全过那里），
   *   不在三个分支各判一次 —— 那就是本仓记过的「二房东」缺陷（改了这边漏那边）。
   * ⛔ 解除**只有一条路**：用户点状态条上的「恢复播报」（`requestAnnounceResume`）。
   *   ⛔ 刻意**不**跟着回合结束自动解除：用户按停的语义是「我现在不想听」，
   *   下一回合又自动开口 = 白按。开关翻转也会解除（见设置订阅处）。
   */
  const mutedRef = useRef(false);
  /** 状态栏要显示「来源」：这一轮是结束播报稿 / 还是模型主动插播 */
  const sourceRef = useRef<AnnounceStatus["source"]>("");
  /** 还有多少句在「合成中/排队合成」（不含已经排进 AudioContext 的那些） */
  const busyRef = useRef(0);
  /**
   * 用户已按停（状态栏显示「已停止播报 · 恢复」并**常驻**，直到用户点恢复或重新打开总开关）。
   * ⛔ 10-12 起它不再有「1.6 秒后自动收起」的定时器：那条自动收起是「回执」语义，
   *    而按停现在同时意味着**静音闩锁**（`mutedRef`）—— 提示条若自己消失了，
   *    用户就再也找不到恢复入口（等于永久失去播报，比"停不下来"更糟）。
   */
  const stoppedRef = useRef(false);
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
   * 本回合已播字数（10-12「不用这么长」的判据）。与 `spokenKeysRef` 同为**回合级**，
   * 收尾/被打断时一起清零。
   */
  const spentCharsRef = useRef(0);
  const resetTurnBudget = useCallback(() => {
    spentCharsRef.current = 0;
    clearSpokenKeys();
  }, [clearSpokenKeys]);
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
      muted: mutedRef.current,
    });
  }, []);

  /** 清空流式链的跨句状态（回合边界 / 被打断 / 停播时都要做，否则按住的半句会在下一轮被念出来）。
   *  ⛔ 声明位置必须在 `stopPlayback` **之前**：依赖数组在 render 期求值，放后面会 TDZ 报错。 */
  const resetLive = useCallback(() => {
    stripperRef.current = null;
    chunkerRef.current = null;
    filterRef.current = null;
  }, []);

  const stopPlayback = useCallback((byUser = false) => {
    epochRef.current += 1;
    for (const source of queueRef.current) {
      try { source.stop(); } catch { /* 已经播完 */ }
    }
    queueRef.current = [];
    resetLive();
    sourceRef.current = "";
    /* ⛔⛔ 主动停止必须**同时掐掉三条入口的活儿**（10-12「停止都停止不了」的根因修复）：
       · `speakLiveRef = false` —— 否则下一句正文 delta 到达照样合成、照样念；
       · `autoSpeakRef.reset()` —— 否则硬规则下一帧又命中，把本回合重新标成「念正文」；
       · `mutedRef = true`（仅 `byUser`）—— 之后模型再调插播工具也进不来（`speak()` 入口拦）。
       前两条对**任何**停止都该做（通话开始 / 回合边界也要断干净），第三条只对用户主动按停生效
       —— 通话接管与回合切换不该顺手把用户静音闩锁也置上。 */
    speakLiveRef.current = false;
    autoSpeakRef.current?.reset();
    if (byUser) {
      mutedRef.current = true;
      stoppedRef.current = true;
      /* ⛔ 「已停止」现在**常驻**到用户点「恢复播报」为止（10-12：状态条上必须留着那个出口，
         否则按一次就永久失去播报）。原先那个 1.6s 自动收起定时器已整条删除 ——
         它是「回执」语义，而按停现在同时意味着**静音闩锁**，提示条不该自己消失。 */
    }
    publishStatus();
  }, [publishStatus, resetLive]);

  /* ⛔⛔ 10-17 用户令「语音播报切换会话会串会话」：`threadId` 一直在参数里，但**没有任何 effect
     监听它变化** ⇒ 切走之后 A 会话的播报继续在 B 会话里响。⇒ 切会话 = 立即停播（同一套 stopPlayback，
     ⛔ 不置静音闩锁 —— 那不是用户按停）+ 清句子级去重表（避免跨会话误判「这句念过了」）。 */
  const prevAnnounceThreadRef = useRef(threadId);
  useEffect(() => {
    if (prevAnnounceThreadRef.current === threadId) return;
    prevAnnounceThreadRef.current = threadId;
    stopPlayback(false);
    clearSpokenKeys();
  }, [threadId, stopPlayback, clearSpokenKeys]);

  /** 「恢复播报」：解除静音闩锁，让后续播报重新可用（状态条上的按钮 → announce-bus → 这里）。 */
  const resumePlayback = useCallback(() => {
    if (!mutedRef.current) return;
    mutedRef.current = false;
    stoppedRef.current = false;
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
    /* ⛔⛔ 静音闩锁（10-12「停止都停止不了」）：**唯一裁决点**，放在 `speak()` 最前面。
       三条入口（正文实时 delta / 工具插播 toolSpeak / 结束播报稿 finishTurn）全都汇合到这里，
       所以置位一次就等于把整条播报链静默 —— 不需要在三个分支各判一遍（三处各判一半就是
       本仓记过的「二房东」缺陷：改了这边漏那边，下条入口又冒出来念）。 */
    if (mutedRef.current) return;
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
    /* ⛔ 本回合总量预算（10-12「不用这么长」）：队列长度背压管不住 `live` 那条无界正文流，
       必须按**字数**封顶。超出即丢弃本句并**顺手关掉本回合的正文朗读** ——
       否则模型继续吐正文，它就一直尝试合成（每句一次 TTS 往返，纯浪费）。 */
    if (spentCharsRef.current + deduped.text.length > MAX_ANNOUNCE_CHARS_PER_TURN) {
      spentCharsRef.current = MAX_ANNOUNCE_CHARS_PER_TURN;
      speakLiveRef.current = false;
      console.info("[voice-announce] 本回合播报已达字数上限（", MAX_ANNOUNCE_CHARS_PER_TURN, "字），后续内容不再播报");
      return;
    }
    busyRef.current += 1;
    publishStatus();
    try {
      const result: any = await window.codex.voicePreviewVoice({ text: deduped.text, speed: opts.speed, numSteps: ANNOUNCE_NUM_STEPS }).catch(() => null);
      if (epoch !== epochRef.current) return;   // 期间被打断/换轮：这句不念
      if (mutedRef.current) return;              // 合成期间用户按了停止：这句不念
      if (!result?.ok || !result.audioBase64 || !result.sampleRate) {
        // ⛔ 不静默吞：模型没下全 / worker 起不来时，用户会「开了播报却没声音」，日志是唯一线索
        console.warn("[voice-announce] 合成失败：", result?.error ?? "未知错误");
        return;
      }
      const samples = decodeFloat32Base64(result.audioBase64);
      if (samples.length) {
        // ⛔ 登记必须放在「确认会出声」之后：合成失败不登记，后到的兜底句才不会被误吞
        for (const key of deduped.keys) spokenKeysRef.current.add(key);
        spentCharsRef.current += deduped.text.length;
        await play(samples, Number(result.sampleRate), epoch, deduped.text);
      }
    } finally {
      busyRef.current = Math.max(0, busyRef.current - 1);
      publishStatus();
    }
  }, [play, publishStatus]);

  /**
   * 正文增量 → 剥掉播报稿 → 断句 → 朗读清洗 → 逐句合成（与通话链路共用同一套基座函数）。
   * ⛔ 只在 **Codex 标记了本回合**时才被调用（`speakLiveRef`）—— 见总线订阅那处。
   */
  const feedDelta = useCallback(async (delta: string) => {
    sourceRef.current = "live";
    if (!stripperRef.current) stripperRef.current = createVoiceScriptStripper();
    const visible = stripperRef.current.push(String(delta ?? ""));
    if (!visible) return;
    if (!chunkerRef.current) chunkerRef.current = createSentenceChunker({ maxChars: 60 });
    if (!filterRef.current) filterRef.current = createSpeakFilter();
    const epoch = epochRef.current;
    const sentences: string[] = chunkerRef.current.push(visible);
    for (const sentence of sentences) {
      const spoken = filterRef.current.push(sentence);
      if (!spoken) continue;
      await speak(spoken, epoch);
      if (epoch !== epochRef.current) return;
    }
  }, [speak]);

  /**
   * 回合结束：① 若本回合念过正文，先把流式链的尾句念完；② 再念模型写的播报稿。
   * ⛔ 10-09 第二轮起**不再回退到本机压缩摘要**（那条整条删除了）；没写稿就什么都不念。
   */
  const finishTurn = useCallback(async (finalText: string) => {
    const epoch = epochRef.current;
    const live = speakLiveRef.current;
    speakLiveRef.current = false;
    if (live) {
      /* ⛔ 剥离器 `flush()` 把按住的那半行定下来 —— 它一定**不是**播报稿（stripper 已把整块吃掉），
         所以接回去当尾句念完；顺序必须「先喂 tail 再 flush 断句器」，反过来会把 tail 当成新一轮首句。 */
      const tail = stripperRef.current?.flush() ?? "";
      const tailSentences: string[] = [];
      if (tail) {
        if (!chunkerRef.current) chunkerRef.current = createSentenceChunker({ maxChars: 60 });
        if (!filterRef.current) filterRef.current = createSpeakFilter();
        tailSentences.push(...chunkerRef.current.push(tail), ...chunkerRef.current.flush());
      }
      for (const sentence of tailSentences) {
        const spoken = filterRef.current?.push(sentence) ?? "";
        if (!spoken) continue;
        await speak(spoken, epoch);
        if (epoch !== epochRef.current) return;
      }
      resetLive();
    }
    if (!cfgRef.current.enabled) return;
    sourceRef.current = "summary";
    const script = resolveAnnounceSummary(String(finalText ?? ""));
    if (script.text) {
      /* ⛔ 整段一次合成，不再逐句拆（10-21 第二次用户报「播放语音连贯性差，中间还要断一下」）。
         逐句虽然首句出声更快，但每句都是独立的 utterance：各自带句末收尾语调，句界再按
         队列硬拼，听起来就是断开的一截；机器负载一高，后一句还没合成完还会多出真空。
         代价是首句要等整段合成完（实测 50 字稿约 6 秒），换来全程一条连续语流。
         ⛔ 不要为了首句快再退回拆句 —— 那是用户听感上明确否掉的形态。
         `speak()` 内部仍会做去重、预算与静音闩锁，行为不变。 */
      await speak(script.text, epoch);
    }
  }, [resetLive, speak]);

  /** 模型主动插播（`voice_announce` 工具）：⛔ 不看开关 —— 显式调用就是用户想听这一句 */
  const speakNow = useCallback(async (text: string, speed?: number) => {
    /* ⛔ 静音闩锁期间直接返回（10-12）：**「用户按了停止」优先于「模型想插播」**。
       此处必须早于 `stoppedRef = false` —— 否则状态条会被翻回「正在念」，
       而 `speak()` 入口又会把声音拦掉 ⇒ 界面显示在念、实际没声，更让人以为"停止坏了"。 */
    if (mutedRef.current) return;
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
    /* ⛔ 这里的解除动作走 ref 而不是 `resumePlayback`：本 effect 的依赖是 `[]`（只跑一次），
       直接引 `resumePlayback` 会拿到首帧的闭包。`mutedRef` / `stoppedRef` / `publishStatus`
       全是 ref 或稳定引用，读到的永远是最新值 —— 不制造过期闭包这个坑。 */
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
      /* ⛔ 用户把总开关**重新打开** = 明确表示"我又想听了" ⇒ 顺手解除静音闩锁（10-12）。
         否则会出现最别扭的一种状态：设置页显示"播报已开启"，但界面上永远不出声
         （闩锁还挂着），用户完全不知道该怎么恢复 —— 这正是"停止按钮不可信"的另一种形态。 */
      if (enabled && mutedRef.current) {
        mutedRef.current = false;
        stoppedRef.current = false;
      }
      /* ★ 预热：播报要在回合结束时才合成，第一次还要加载 156MB 克隆模型 ⇒ 用户听到的是
         「回合结束好几秒后才开口」。开关打开/音色切换时先让主进程把试听 worker 建起来
         （空合成一句「好」，不播放、不登记）。失败（模型没装）则清掉 key，下次设置变化再试。
         ⛔ 只按 profileId 变化触发：调语速/音量时不该重复加载模型。 */
      const profileId = typeof raw.tts?.profileId === "string" ? raw.tts.profileId : "";
      if (enabled && warmKeyRef.current !== profileId) {
        warmKeyRef.current = profileId;
        void window.codex.voicePreviewVoice({ warm: true })
          .then((r: any) => { if (!r?.ok) warmKeyRef.current = null; })
          .catch(() => { warmKeyRef.current = null; });
      }
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
      if (event.type === "delta") {
        /* ⛔ 逐条判断（用户 10-09 第五轮）：**只有 Codex 标记过本回合**才念正文 ——
           不是每条回复都念，也不是开关控制（开关管的是"念不念播报稿"这个默认行为）。 */
        if (!speakLiveRef.current) return;
        if (!cfgRef.current.enabled) return;   // 用户把播报关掉 ⇒ 正文也不念（比插播更"自动"，必须尊重开关）
        enqueueTask(() => feedDelta(event.text));
        return;
      }
      if (event.type === "toolSpeak") {
        /* ⛔ 会话闸：`harness:event` 是**全窗口广播**，而这个 app 可以有多个窗口/多个会话。
           不比对 ⇒ 另一个窗口里那条群的插播会在当前窗口一起念出来（跨场合念 = 听起来像见鬼）。 */
        if (threadId && event.threadId && event.threadId !== threadId) return;
        /* ⛔ 静音闩锁期间**不许**把 `stoppedRef` 复位（10-12）：用户刚按了停止，模型紧接着又插播，
           复位 = 状态条从「已停止」跳回「正在念」—— 用户看到的是「我明明按了它还在念」。
           真正的拦截在 `speak()` 入口，这里只保证**显示**不撒谎。 */
        if (!mutedRef.current) stoppedRef.current = false;
        enqueueTask(() => speakNow(event.text, event.speed));
        return;
      }
      if (event.type === "turnDone") {
        /* ⛔ 被打断的回合：**别再念了** —— 刚写出来的半句停在原地，等用户的新话。
           ⛔ 去重登记表与**字数预算是回合级**的：收尾（含播报稿）也要参与本回合查重/扣字数，
              所以清表必须排在 finishTurn **之后**；`speakLiveRef` 的复位在 finishTurn 内部（尾句要先念完）。 */
        autoSpeakRef.current?.reset();   // 硬规则的计数是**逐回合**的
        if (event.aborted) { epochRef.current += 1; speakLiveRef.current = false; resetLive(); resetTurnBudget(); publishStatus(); return; }
        if (!cfgRef.current.enabled && !speakLiveRef.current) { resetTurnBudget(); return; }
        enqueueTask(() => finishTurn(event.text).finally(resetTurnBudget));
      }
    });
    return off;
  }, [enqueueTask, feedDelta, finishTurn, publishStatus, resetLive, resetTurnBudget, speakNow, threadId]);

  /* ── `voice_announce` / `voice_announce_stop` / `voice_speak_reply` 工具（主进程 dispatch-rpc 广播）──
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
      if (payload.action === "speak-reply") {
        /* ⛔ Codex 决定「这一条回复念出来」（运行中）。只**标记本回合**并把流式链重置到开头，
           真正的念由总线订阅的 delta 分支做（那处判 speakLiveRef）—— 判据只有一份。
           ⛔ 静音期间**不许**重新开口（10-12）：用户刚按了停止，模型紧接着就要念正文 =
           "停止按钮是假的"。状态条也不许翻回「正在念」（`speakLiveRef` 保持 false ⇒ 显示一致）。 */
        if (mutedRef.current) return;
        speakLiveRef.current = true;
        resetLive();
        stoppedRef.current = false;
        return;
      }
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
  }, [resetLive, stopPlayback, threadId]);

  /* ── 两条硬规则：宿主侧的自动播报兜底（10-09 第六轮，用户拍板）──────────────────
     ① 单回合工具调用 **> 10 次**；② **同一个问题被返工 ≥2 次**（同一命令/同一文件/同参数同工具）。
     ⛔ 与 `voice_speak_reply` 走**同一条路**（标记本回合 `speakLiveRef`）—— 判据只有一份，
        两个入口不会各判一半（本项目记过的「二房东」缺陷）。
     ⛔ 受总开关管：用户关掉播报 ⇒ 自动播报也不生效（更"自动"的东西更要尊重开关）。
     ⛔ 通话中不参与：那时由通话链路负责念回复。 */
  useEffect(() => {
    if (!threadId) return;
    const tracker = createAutoSpeakTracker();
    autoSpeakRef.current = tracker;
    const off = window.codex.onEvent((event: any) => {
      if (event?.kind !== "notification") return;
      const params = event?.params ?? {};
      if (String(params.threadId ?? "") !== threadId) return;
      if (String(event.method ?? "") !== "item/started") return;
      if (!cfgRef.current.enabled) return;
      if (getVoiceStage().active) return;
      /* ⛔ 静音闩锁期间硬规则**不许**再把本回合标成「念正文」（10-12）：用户已明确喊停，
         自动兜底这时继续开口 = 直接违抗用户。计数照样累计（用户中途恢复后仍能正常命中）。 */
      if (mutedRef.current) return;
      const reason = tracker.push(params.item);
      if (!reason) return;
      speakLiveRef.current = true;
      resetLive();
      stoppedRef.current = false;
      console.info("[voice-announce] 自动播报（硬规则命中）：", reason);
    });
    return () => { off?.(); tracker.reset(); autoSpeakRef.current = null; };
  }, [resetLive, threadId]);

  // 「停止播报」出口（状态栏 / 悬浮球右键菜单）：非通话播报不开麦、界面很小，
  // 没有这个出口用户就只能等它念完 —— 与 wave-level 的结束通话/打断同一套广播注册。
  useEffect(() => {
    setAnnounceStopHandler(() => { stopPlayback(true); });
    /* ⛔ 「恢复播报」出口（10-12）：静音闩锁必须可解除，否则用户按一次停止就永久失去播报
       （比"停不下来"更糟：他想听的时候再也听不到了）。与停止出口成对注册、一起注销 ——
       两个出口的生命周期必须绑在同一个 effect，否则卸载时容易只清掉一个（留下一个指向
       已卸载 hook 的回调 = 下次点击报 "Cannot read properties of null"）。 */
    setAnnounceResumeHandler(() => { resumePlayback(); });
    // 通话一开始就停掉独立播报：否则通话的播报与这里排队的音频会同时出声
    const offStage = subscribeVoiceStage((stage) => { if (stage.active) stopPlayback(); });
    return () => { setAnnounceStopHandler(null); setAnnounceResumeHandler(null); offStage(); };
  }, [resumePlayback, stopPlayback]);

  // 卸载：释放音频上下文（不留后台播放）
  useEffect(() => () => {
    epochRef.current += 1;
    publishAnnounceStatus(IDLE_ANNOUNCE_STATUS);
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
  }, []);
}
