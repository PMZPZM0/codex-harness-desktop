/**
 * MOSS-Live 全双工实时语音客户端（11-10 立；11-11 按官方协议重写）。
 *
 * 官方协议（platform.moss.cn/docs/reference/moss-live）与 OpenAI Realtime **不同**，不要混用：
 *   · 连接：`wss://api.mosi.cn/v1/realtime?model=moss-live-1.0`，`Authorization: Bearer <key>`；
 *   · 建会话：文本帧 `{"action":"attach_session","session_id":null}` → 等 `session_attached`；
 *   · 开麦：`{"action":"mic_state","enabled":true}`；
 *   · 上行：**二进制帧**，16 kHz 单声道 PCM S16LE（不是 base64 JSON）；
 *   · 下行：`response.audio.context`（run_id/turn_id/chunk_id）后紧跟**二进制帧**，
 *     48 kHz 单声道 PCM S16LE；
 *   · 字幕：`input.transcript.updated/done`、`output.transcript.updated/done`，
 *     `data.text` 是**当前完整文本**（覆盖，不拼接）；
 *   · 打断：服务端发 `response.audio.stop`，客户端停播后回 `playback.stopped`；
 *   · 播放回执：`playback.chunk.completed` / `playback.completed`（按实际播放进度）。
 *
 * ⛔ 不做本地 ASR/TTS、不碰引擎回合——端到端语音由服务端完成。
 * ⛔ 未配置/连不上 ⇒ 回调 onError，VoiceService 如实报错并回落本地链路，不静默失败。
 */
import WebSocket from "ws";

export type MossAudioMeta = { runId: string; turnId: string; chunkId: string };

export type MossLiveCallbacks = {
  onUserPartial?: (text: string) => void;
  onUserFinal?: (text: string) => void;
  /** 模型语音字幕：text 是**当前完整文本**（更新时覆盖，不追加）；done = 本回复最终稿 */
  onAgentTranscript?: (text: string, done: boolean) => void;
  /** base64 PCM16 + 采样率（默认 48k） */
  onAudio?: (base64: string, sampleRate: number, meta?: MossAudioMeta) => void;
  /** 服务端要求停止播放（用户打断） */
  onBarge?: (runId?: string, turnId?: string) => void;
  /** 本次回复结束（completed / aborted / failed / interrupted） */
  onDone?: (status?: string) => void;
  onError?: (message: string) => void;
  onSession?: (info: { sessionId: string; memoryScope?: string; delegation?: string }) => void;
};

export type MossLiveConfig = { baseUrl: string; model: string; apiKey: string };

/** 上行麦克风 16k；下行默认 48k（官方 standard 预设）。 */
export const MOSS_INPUT_RATE = 16000;
export const MOSS_OUTPUT_RATE = 48000;
export const MOSS_DEFAULT_MODEL = "moss-live-1.0";

/**
 * 把用户填的地址归一化成官方 Realtime WebSocket 地址。
 * 支持三种填法：完整 `wss://…/v1/realtime`、基址 `https://api.mosi.cn/v1`、裸域名。
 * ⛔ 填成 `/audio/speech`（TTS）时直接拒绝并说明，别让它连一个语义不对的端点。
 */
export function mossRealtimeUrl(cfg: Pick<MossLiveConfig, "baseUrl" | "model">): string {
  const raw = String(cfg.baseUrl ?? "").trim();
  if (!raw) throw new Error("未填写接口地址");
  if (/\/audio\/speech\b/i.test(raw)) {
    throw new Error("这个地址是语音合成（TTS）接口；实时通话要填 wss://api.mosi.cn/v1/realtime");
  }
  let text = raw;
  if (/^https?:\/\//i.test(text)) text = text.replace(/^http/i, "ws");
  else if (!/^wss?:\/\//i.test(text)) text = `wss://${text}`;
  let url: URL;
  try { url = new URL(text); } catch { throw new Error("接口地址不是合法 URL"); }
  if (!/\/realtime\/?$/.test(url.pathname)) {
    if (/\/v1\/?$/.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/+$/, "")}/realtime`;
    else if (!/\/v1\//.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/realtime`;
    else url.pathname = `${url.pathname.replace(/\/+$/, "")}/realtime`;
  }
  url.searchParams.set("model", String(cfg.model ?? "").trim() || MOSS_DEFAULT_MODEL);
  return url.toString();
}

function float32ToPcm16Buffer(samples: Float32Array): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  return buf;
}

/** ws 的 data 在 nodebuffer 模式下是 Buffer；这里兜住 ArrayBuffer/Buffer[] 两种形态。 */
function toBuffer(raw: unknown): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw as Buffer[]);
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  return Buffer.from(String(raw ?? ""));
}

export class MossLiveRealtime {
  private ws: WebSocket | null = null;
  private closed = false;
  private attached = false;
  private sessionId = "";
  private outputRate = MOSS_OUTPUT_RATE;
  /** 下一条二进制帧的关联信息（服务端先发 response.audio.context） */
  private pendingContext: MossAudioMeta | null = null;
  /** 播放回执时钟：各片段预计播完时刻（毫秒时间戳） */
  private playbackEndAt = 0;
  private receiptTimers = new Set<ReturnType<typeof setTimeout>>();
  /** 已收到 response.audio.done 但还在播的 run */
  private audioDoneRuns = new Set<string>();
  private completedSent = new Set<string>();
  /** 当前正在播的片段（打断时算 played_audio_ms） */
  private currentChunk: (MossAudioMeta & { startAt: number; endAt: number }) | null = null;
  /** run_id → turn_id（回 playback.completed 时 turn_id 必填） */
  private readonly runTurns = new Map<string, string>();

  constructor(private readonly cfg: MossLiveConfig, private readonly cb: MossLiveCallbacks) {}

  /** 建连 + attach_session；resolve 于 session_attached（不是 open）。 */
  connect(timeoutMs = 20000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (err) reject(err); else resolve();
      };
      let url: string;
      try { url = mossRealtimeUrl(this.cfg); } catch (e: any) { reject(e); return; }
      const timer = setTimeout(() => { this.close(); finish(new Error("MOSS-Live 连接/建会话超时")); }, timeoutMs);
      try {
        this.ws = new WebSocket(url, {
          headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
          perMessageDeflate: false,
        });
      } catch (e) { clearTimeout(timer); finish(e instanceof Error ? e : new Error(String(e))); return; }

      this.ws.on("open", () => {
        // ⛔ 必须先建会话；session_attached 之前不能发音频。
        this.send({ action: "attach_session", session_id: null });
      });
      this.ws.on("message", (raw, isBinary) => {
        try {
          if (isBinary) this.handleBinary(toBuffer(raw));
          else this.handleText(String(raw), () => { clearTimeout(timer); finish(); });
        } catch (e: any) {
          this.cb.onError?.(`MOSS-Live 消息处理失败：${e?.message ?? e}`);
        }
      });
      this.ws.on("error", (e) => {
        clearTimeout(timer);
        this.cb.onError?.(`MOSS-Live 连接错误：${e.message}`);
        finish(new Error(e.message));
      });
      this.ws.on("close", () => {
        clearTimeout(timer);
        this.clearReceipts();
        if (!this.attached) finish(new Error("MOSS-Live 连接已关闭（未完成建会话）"));
        else if (!this.closed) this.cb.onError?.("MOSS-Live 连接已断开");
      });
    });
  }

  private handleText(raw: string, onAttached: () => void): void {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    const action = String(msg?.action ?? "");
    const data = msg?.data && typeof msg.data === "object" ? msg.data : {};
    switch (action) {
      case "session_attached": {
        this.attached = true;
        this.sessionId = String(data.session_id ?? "");
        this.cb.onSession?.({
          sessionId: this.sessionId,
          memoryScope: data.memory_scope ? String(data.memory_scope) : undefined,
          delegation: data.delegation ? String(data.delegation) : undefined,
        });
        // 会话就绪后开麦：之后持续送 16k PCM16 二进制帧（含静音）。
        this.send({ action: "mic_state", enabled: true });
        onAttached();
        break;
      }
      case "session.updated":
        if (data.error) this.cb.onError?.(`MOSS-Live 会话配置失败：${String(data.error)}`);
        break;
      case "media.configured": {
        const rate = Number(data?.output_audio?.sample_rate ?? 0);
        if (Number.isFinite(rate) && rate > 0) this.outputRate = rate;
        break;
      }
      case "input.transcript.updated":
        this.cb.onUserPartial?.(String(data.text ?? ""));
        break;
      case "input.transcript.done":
        this.cb.onUserFinal?.(String(data.text ?? ""));
        break;
      case "output.transcript.updated":
        this.cb.onAgentTranscript?.(String(data.text ?? ""), false);
        break;
      case "output.transcript.done":
        this.cb.onAgentTranscript?.(String(data.text ?? ""), true);
        break;
      case "response.audio.context":
        this.pendingContext = {
          runId: String(data.run_id ?? ""),
          turnId: String(data.turn_id ?? ""),
          chunkId: String(data.chunk_id ?? ""),
        };
        break;
      case "response.audio.done":
        this.markAudioDone(String(data.run_id ?? ""), String(data.turn_id ?? ""));
        break;
      case "response.audio.stop":
        this.handleServerStop(String(data.run_id ?? ""), String(data.turn_id ?? ""));
        break;
      case "response.ended":
        this.cb.onDone?.(String(data.status ?? "completed"));
        break;
      case "response.interrupted":
        if (typeof data.text === "string" && data.text) this.cb.onAgentTranscript?.(data.text, true);
        this.cb.onDone?.("interrupted");
        break;
      case "error": {
        const err = data.error ?? {};
        const code = String(err.code ?? "");
        const message = String(err.message ?? "未知错误");
        this.cb.onError?.(`MOSS-Live${code ? ` [${code}]` : ""}：${message}`);
        break;
      }
      default:
        break;
    }
  }

  private handleBinary(raw: Buffer): void {
    const meta = this.pendingContext;
    this.pendingContext = null;
    this.cb.onAudio?.(raw.toString("base64"), this.outputRate, meta ?? undefined);
    if (!meta) return;
    // 按音频时长推播放进度，播完回 playback.chunk.completed（官方要求的回执）。
    const durationMs = (raw.length / 2 / this.outputRate) * 1000;
    const now = Date.now();
    const startAt = Math.max(now, this.playbackEndAt);
    const endAt = startAt + durationMs;
    this.playbackEndAt = endAt;
    this.currentChunk = { ...meta, startAt, endAt };
    if (meta.runId) this.runTurns.set(meta.runId, meta.turnId);
    const timer = setTimeout(() => {
      this.receiptTimers.delete(timer);
      this.send({
        action: "playback.chunk.completed",
        run_id: meta.runId, turn_id: meta.turnId, chunk_id: meta.chunkId,
      });
      if (this.currentChunk?.chunkId === meta.chunkId && this.currentChunk?.runId === meta.runId) {
        this.currentChunk = null;
      }
      this.maybeSendCompleted(meta.runId);
    }, Math.max(0, endAt - now));
    this.receiptTimers.add(timer);
  }

  private markAudioDone(runId: string, turnId: string): void {
    if (runId) this.audioDoneRuns.add(runId);
    // 音频已全部下发：等最后一个片段播完再回 playback.completed。
    if (this.playbackEndAt <= Date.now()) {
      this.send({ action: "playback.completed", run_id: runId, turn_id: turnId });
      this.completedSent.add(runId);
    }
  }

  private maybeSendCompleted(runId: string): void {
    if (!runId || !this.audioDoneRuns.has(runId) || this.completedSent.has(runId)) return;
    if (this.currentChunk && this.currentChunk.runId === runId) return;
    if (this.playbackEndAt > Date.now()) return;
    this.send({ action: "playback.completed", run_id: runId, turn_id: this.runTurns.get(runId) ?? "" });
    this.completedSent.add(runId);
  }

  /** 服务端要求停播：已播完的片段回执已发过，这里只报当前队首的已播时长。 */
  private handleServerStop(runId: string, turnId: string): void {
    const now = Date.now();
    let playedMs = 0;
    const cur = this.currentChunk;
    if (cur && (!runId || cur.runId === runId)) {
      playedMs = Math.max(0, Math.min(cur.endAt - cur.startAt, now - cur.startAt));
    }
    this.clearReceipts();
    this.playbackEndAt = now;
    this.send({ action: "playback.stopped", run_id: runId, turn_id: turnId, played_audio_ms: Math.round(playedMs) });
    this.cb.onBarge?.(runId, turnId);
  }

  private clearReceipts(): void {
    for (const t of this.receiptTimers) clearTimeout(t);
    this.receiptTimers.clear();
    this.currentChunk = null;
  }

  /** 上行一帧麦克风 PCM（16k Float32 → PCM16 二进制帧）。 */
  feed(samples: Float32Array): void {
    if (!this.attached || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!samples.length) return;
    try { this.ws.send(float32ToPcm16Buffer(samples)); } catch { /* 断线由 close 统一报 */ }
  }

  /**
   * 用户本地打断：MOSS 不需要 response.cancel —— 继续送音频，由服务端判定并回 `response.audio.stop`。
   * 这里只做本地清理（停播由渲染层执行）。
   */
  cancel(): void { /* 故意为空：见上方注释 */ }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  close(): void {
    this.closed = true;
    this.attached = false;
    this.clearReceipts();
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
  }
}
