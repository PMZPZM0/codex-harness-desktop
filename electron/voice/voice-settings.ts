/**
 * 语音通话设置：音色 / 语速 / 打断灵敏度 / 打断方式 / 模型镜像源。
 *
 * 存放在 userData/voice-settings.json（与 bot-stream / personalization 同款），
 * 由主进程读写并对外暴露 IPC；渲染层用设置时通过 `voice:settings-get` 取最新值。
 *
 * 设计要点：
 * - 镜像源默认 "auto"：优先 huggingface.co，国内走 hf-mirror（用户无须感知）。
 *   想强制某一边的可以从设置切；切了之后 `voice:models-install` 按该顺序试，
 *   失败再降级（与原双镜像兜底一致）。
 * - 音色 sid 是 sherpa-onnx VITS 的说话人 id（vits-zh-ll 有 5 个：0..4），
 *   名字按"音色 N"展示，等真正跑 TTS 时再从模型拿 numSpeakers 决定要不要多显示。
 * - 任何写入都先读旧值再合并，避免丢字段。
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export type BargeMode = "auto" | "manual";
export type ModelHost = "auto" | "huggingface" | "hf-mirror";

export type VoiceSettings = {
  tts: { sid: number; speed: number };
  barge: { gateDb: number; mode: BargeMode };
  modelHost: ModelHost;
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  tts: { sid: 0, speed: 1.0 },
  barge: { gateDb: 6, mode: "auto" },
  modelHost: "auto",
};

export const TTS_VOICE_NAMES: Record<number, string> = {
  0: "音色 1",
  1: "音色 2",
  2: "音色 3",
  3: "音色 4",
  4: "音色 5",
};

export const MODEL_HOST_PRESETS: Record<ModelHost, readonly string[]> = {
  // 自动：主源 HF（全球可达），国内自动降级到 hf-mirror
  auto: ["https://huggingface.co", "https://hf-mirror.com"],
  // 强制：只走 HF（适合海外或自备代理的）
  huggingface: ["https://huggingface.co"],
  // 强制：只走 hf-mirror（国内直连最快）
  "hf-mirror": ["https://hf-mirror.com"],
};

export const MODEL_HOST_LABELS: Record<ModelHost, string> = {
  auto: "自动（HF 优先，国内降级到镜像）",
  huggingface: "仅 huggingface.co（海外/有代理）",
  "hf-mirror": "仅 hf-mirror.com（国内直连最快）",
};

export function voiceSettingsFile(userDataDir: string): string {
  return join(userDataDir, "voice-settings.json");
}

/** 读出当前设置（不存在或损坏时回退到默认值，并就地写回一份规范文件）。 */
export function loadVoiceSettings(userDataDir: string): VoiceSettings {
  const file = voiceSettingsFile(userDataDir);
  try {
    if (!existsSync(file)) {
      writeFileSync(file, JSON.stringify(DEFAULT_VOICE_SETTINGS, null, 2), "utf8");
      return { ...DEFAULT_VOICE_SETTINGS };
    }
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<VoiceSettings>;
    return mergeSettings(raw);
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

/** 部分写入并落盘；返回合并后的完整设置。 */
export function saveVoiceSettings(userDataDir: string, patch: Partial<VoiceSettings>): VoiceSettings {
  const current = loadVoiceSettings(userDataDir);
  const next = mergeSettings({ ...current, ...patch });
  writeFileSync(voiceSettingsFile(userDataDir), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function mergeSettings(raw: Partial<VoiceSettings> | undefined): VoiceSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_VOICE_SETTINGS };
  const tts = raw.tts ?? DEFAULT_VOICE_SETTINGS.tts;
  const barge = raw.barge ?? DEFAULT_VOICE_SETTINGS.barge;
  const modelHost = (raw.modelHost && MODEL_HOST_PRESETS[raw.modelHost]) ? raw.modelHost : DEFAULT_VOICE_SETTINGS.modelHost;
  return {
    tts: {
      sid: clampInt(tts.sid, 0, 4, DEFAULT_VOICE_SETTINGS.tts.sid),
      speed: clampNum(tts.speed, 0.5, 2.0, DEFAULT_VOICE_SETTINGS.tts.speed),
    },
    barge: {
      gateDb: clampInt(barge.gateDb, 3, 12, DEFAULT_VOICE_SETTINGS.barge.gateDb),
      mode: barge.mode === "manual" ? "manual" : "auto",
    },
    modelHost,
  };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? Math.round(v) : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
