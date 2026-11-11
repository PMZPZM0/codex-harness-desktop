/**
 * MOSS-TTS（远端语音播报）——语音服务里只留调用点，具体协议/解码收在本模块。
 *
 * 官方接口：`POST /v1/audio/speech`，字段 `{ model, input, voice_id, response_format:"wav" }`，
 * 鉴权 Bearer；音色列表 `GET /v1/audio/voices`。返回 48k 立体声 16-bit WAV。
 *
 * ⛔ 独立成模块：`voice-service.ts` 受守卫【265】行数棘轮约束（只许缩不许长）。
 * ⛔ 密钥只在主进程；调用方传进来的 settings 已由 IPC 层脱敏给渲染层。
 */
import { guardedFetch } from "../net-guard";
import type { RemoteVoiceConfig, VoiceSettings } from "./voice-settings";

export const MOSS_TTS_DEFAULT_URL = "https://api.mosi.cn/v1/audio/speech";
export const MOSS_TTS_DEFAULT_MODEL = "moss-tts-1.5-flash";
export const MOSS_VOICES_URL = "https://api.mosi.cn/v1/audio/voices";

export type MossTtsConfig = { baseUrl: string; model: string; voiceId: string; apiKey: string };
export type MossSpeakResult = { ok: true; sampleRate: number; samples: Float32Array } | { ok: false; error: string };

/** 解 MOSS-TTS 返回的 WAV（16-bit PCM，可能是 48k 立体声）→ 单声道 Float32。 */
export function decodeWavPcm16Mono(buf: Buffer): { samples: Float32Array; sampleRate: number } {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    return { samples: new Float32Array(), sampleRate: 0 };
  }
  let offset = 12;
  let channels = 1;
  let sampleRate = 48000;
  let bits = 16;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt " && size >= 16) {
      channels = Math.max(1, buf.readUInt16LE(offset + 10));
      sampleRate = Math.max(1, buf.readUInt32LE(offset + 12));
      bits = buf.readUInt16LE(offset + 22);
    } else if (id === "data") {
      dataOffset = offset + 8;
      dataSize = Math.min(size, buf.length - dataOffset);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0 || bits !== 16) return { samples: new Float32Array(), sampleRate };
  const frameBytes = 2 * channels;
  const frames = Math.floor(dataSize / frameBytes);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += buf.readInt16LE(dataOffset + i * frameBytes + c * 2);
    out[i] = sum / channels / 32768;
  }
  return { samples: out, sampleRate };
}

/**
 * 播报配置：
 * - 未开启 / 选了克隆音色 ⇒ null（本地；克隆只在本机）；
 * - 开启但缺音色/密钥 ⇒ {ok:false}（明确报错，不静默换本地）。
 */
export function remoteTtsConfig(settings?: VoiceSettings):
  | { ok: true; cfg: MossTtsConfig }
  | { ok: false; error: string }
  | null {
  const s = settings;
  if (s?.tts?.remote !== true) return null;
  if (String(s.tts?.profileId ?? "").trim()) return null;
  const entry: RemoteVoiceConfig | undefined = s.remote?.["moss-tts"];
  const live: RemoteVoiceConfig | undefined = s.remote?.["moss-live"];
  const baseUrl = String(entry?.baseUrl ?? MOSS_TTS_DEFAULT_URL).trim() || MOSS_TTS_DEFAULT_URL;
  const model = String(entry?.model ?? MOSS_TTS_DEFAULT_MODEL).trim() || MOSS_TTS_DEFAULT_MODEL;
  const voiceId = String(entry?.voiceId ?? "").trim();
  const apiKey = String(entry?.apiKey || live?.apiKey || "").trim();
  if (!voiceId) {
    return { ok: false, error: "MOSS 播报已开启，但还没选音色：到 设置 → 语音通话 → MOSS-Live 里点「查询音色」选一个" };
  }
  if (!apiKey) return { ok: false, error: "MOSS 播报缺少 API 密钥：先在 MOSS-Live 卡片保存密钥" };
  return { ok: true, cfg: { baseUrl, model, voiceId, apiKey } };
}

/** 调 MOSS 单人语音生成（POST /v1/audio/speech，返回 48k WAV）。 */
export async function speakMoss(text: string, cfg: MossTtsConfig): Promise<MossSpeakResult> {
  const clean = String(text ?? "").trim().slice(0, 2000);
  if (!clean) return { ok: false, error: "空文本" };
  try {
    const res = await guardedFetch(cfg.baseUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      // ⛔ 官方字段是 voice_id（不是 voice）；wav 便于本地无损解码，不引入 mp3 解码依赖。
      body: JSON.stringify({ model: cfg.model, input: clean, voice_id: cfg.voiceId, response_format: "wav" }),
    }, { timeoutMs: 60_000, retries: 0 });
    const contentType = String(res.headers.get("content-type") ?? "");
    if (!res.ok || contentType.includes("json")) {
      const raw = await res.text().catch(() => "");
      let detail = raw.slice(0, 200);
      try { const j: any = JSON.parse(raw); detail = String(j?.error?.message ?? j?.message ?? detail); } catch { /* 非 JSON 保留原文 */ }
      return { ok: false, error: `MOSS 播报失败（${res.status}）${detail ? `：${detail}` : ""}` };
    }
    const decoded = decodeWavPcm16Mono(Buffer.from(await res.arrayBuffer()));
    if (!decoded.samples.length) return { ok: false, error: "MOSS 播报返回的音频无法解码（需要 16-bit PCM WAV）" };
    return { ok: true, sampleRate: decoded.sampleRate, samples: decoded.samples };
  } catch (error: any) {
    return { ok: false, error: `MOSS 播报失败：${error?.message ?? error}` };
  }
}

/** 查询 MOSS 账号可用音色（UI 选音色用；只回 id/name，不回密钥）。 */
export async function listMossVoices(settings: VoiceSettings): Promise<{ ok: boolean; voices?: { id: string; name: string }[]; error?: string }> {
  const entry: RemoteVoiceConfig | undefined = settings.remote?.["moss-tts"];
  const live: RemoteVoiceConfig | undefined = settings.remote?.["moss-live"];
  const apiKey = String(entry?.apiKey || live?.apiKey || "").trim();
  if (!apiKey) return { ok: false, error: "先在上方 MOSS-Live 卡片保存 API 密钥" };
  try {
    const res = await guardedFetch(`${MOSS_VOICES_URL}?limit=50`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, { timeoutMs: 15_000 });
    if (!res.ok) return { ok: false, error: `查询音色失败（${res.status}）` };
    const j: any = await res.json();
    const voices = (Array.isArray(j?.data) ? j.data : [])
      .map((v: any, i: number) => ({ id: String(v?.id ?? ""), name: String(v?.name || `音色 ${i + 1}`) }))
      .filter((v: { id: string }) => Boolean(v.id));
    return { ok: true, voices };
  } catch (error: any) {
    return { ok: false, error: `查询音色失败：${error?.message ?? error}` };
  }
}

/** MOSS 音色试听：用草稿 model/voiceId 合成一句，不要求先开启播报。 */
export async function previewMossVoice(
  settings: VoiceSettings,
  input?: { model?: string; voiceId?: string; text?: string },
): Promise<MossSpeakResult> {
  const entry: RemoteVoiceConfig | undefined = settings.remote?.["moss-tts"];
  const live: RemoteVoiceConfig | undefined = settings.remote?.["moss-live"];
  const apiKey = String(entry?.apiKey || live?.apiKey || "").trim();
  const voiceId = String(input?.voiceId ?? entry?.voiceId ?? "").trim();
  const model = String(input?.model ?? entry?.model ?? MOSS_TTS_DEFAULT_MODEL).trim() || MOSS_TTS_DEFAULT_MODEL;
  if (!apiKey) return { ok: false, error: "先在上方 MOSS-Live 卡片保存 API 密钥" };
  if (!voiceId) return { ok: false, error: "先选择一个音色" };
  return speakMoss(String(input?.text ?? "你好，我是你的语音助手，这是 MOSS 音色试听。"), {
    baseUrl: String(entry?.baseUrl ?? MOSS_TTS_DEFAULT_URL).trim() || MOSS_TTS_DEFAULT_URL,
    model,
    voiceId,
    apiKey,
  });
}
