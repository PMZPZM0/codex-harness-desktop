/**
 * MOSS-Live 全双工实时语音客户端（11-10「实时语音也把这个接一下」）。
 *
 * 走 **OpenAI Realtime 兼容**的 WebSocket 事件协议（session.update / input_audio_buffer.append /
 * response.audio.delta / …，国内实时语音 API 普遍同构，MOSS-Live 亦为此类）。
 * ⛔ 协议为兼容假设：若提供方事件名不同，只需改本文件的映射，不动 VoiceService。
 *
 * 职责：把麦克风 PCM16 上行、把服务端音频/字幕下行，经回调交给 VoiceService 转成渲染层事件。
 * ⛔ 不做本地 ASR/TTS、不碰引擎回合——端到端语音由服务端完成。
 * ⛔ 未配置/连不上 ⇒ 回调 onError，VoiceService 如实报错并回落本地链路，不静默失败。
 */
import WebSocket from "ws";

export type MossLiveCallbacks = {
  onUserPartial?: (text: string) => void;
  onUserFinal?: (text: string) => void;
  onAgentDelta?: (text: string) => void;
  /** base64 PCM16 + 采样率 */
  onAudio?: (base64: string, sampleRate: number) => void;
  onDone?: () => void;
  onBarge?: () => void;
  onError?: (message: string) => void;
  onOpen?: () => void;
};

export type MossLiveConfig = { baseUrl: string; model: string; apiKey: string };

/** 上行麦克风 16k、下行默认 24k（OpenAI Realtime 惯例；服务端 session 可改）。 */
export const MOSS_INPUT_RATE = 16000;
export const MOSS_OUTPUT_RATE = 24000;

function realtimeUrl(cfg: MossLiveConfig): string {
  const base = cfg.baseUrl.trim().replace(/\/+$/, "");
  const root = /\/realtime$/.test(base) ? base : `${base}/realtime`;
  return `${root}?model=${encodeURIComponent(cfg.model)}`;
}

export class MossLiveRealtime {
  private ws: WebSocket | null = null;
  private closed = false;

  constructor(private readonly cfg: MossLiveConfig, private readonly cb: MossLiveCallbacks) {}

  /** 建连并配置会话；resolve 于 open（session.updated 异步到达）。 */
  connect(timeoutMs = 15000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err?: Error) => { if (!settled) { settled = true; err ? reject(err) : resolve(); } };
      const timer = setTimeout(() => { this.close(); done(new Error("MOSS-Live 连接超时")); }, timeoutMs);
      try {
        this.ws = new WebSocket(realtimeUrl(this.cfg), {
          headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
        });
      } catch (e) { clearTimeout(timer); done(e instanceof Error ? e : new Error(String(e))); return; }
      this.ws.on("open", () => {
        clearTimeout(timer);
        this.send({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            turn_detection: { type: "server_vad" },
          },
        });
        this.cb.onOpen?.();
        done();
      });
      this.ws.on("message", (raw) => this.handle(String(raw)));
      this.ws.on("error", (e) => { this.cb.onError?.(`MOSS-Live 连接错误：${e.message}`); done(new Error(e.message)); });
      this.ws.on("close", () => { if (!this.closed) this.cb.onError?.("MOSS-Live 连接已断开"); });
    });
  }

  private handle(raw: string): void {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg?.type) {
      case "response.audio.delta":
        if (msg.delta) this.cb.onAudio?.(String(msg.delta), MOSS_OUTPUT_RATE);
        break;
      case "response.audio_transcript.delta":
        if (msg.delta) this.cb.onAgentDelta?.(String(msg.delta));
        break;
      case "conversation.item.input_audio_transcription.delta":
        if (msg.delta) this.cb.onUserPartial?.(String(msg.delta));
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (msg.transcript) this.cb.onUserFinal?.(String(msg.transcript));
        break;
      case "input_audio_buffer.speech_started":
        this.cb.onBarge?.();
        break;
      case "response.done":
        this.cb.onDone?.();
        break;
      case "error":
        this.cb.onError?.(`MOSS-Live：${String(msg?.error?.message ?? msg?.message ?? "未知错误")}`);
        break;
      default:
        break;
    }
  }

  /** 上行一帧麦克风 PCM16（base64）。 */
  feed(base64: string): void {
    this.send({ type: "input_audio_buffer.append", audio: base64 });
  }

  /** 用户插话：取消服务端当前响应（全双工打断）。 */
  cancel(): void {
    this.send({ type: "response.cancel" });
  }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  close(): void {
    this.closed = true;
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
  }
}
