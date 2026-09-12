/**
 * 语音通话设置：音色 / 语速 / 音量 / 断句 / 麦克风 / 打断 / 镜像源。
 *
 * 存放在 userData/voice-settings.json（与 bot-stream / personalization 同款），
 * 由主进程读写并对外暴露 IPC；渲染层通过 `voice:settings-get` 取最新值。
 *
 * 设计要点：
 * - 镜像源默认 "auto"：优先 huggingface.co，国内走 hf-mirror（用户无须感知）。
 * - 音色 sid 是 sherpa-onnx VITS 的说话人 id（vits-zh-ll 有 5 个：0..4）。
 * - 断句三参数对应 sherpa-onnx 的 endpoint 规则：
 *     rule1 = 常规句尾静音阈值（秒，调小→反应快但容易截断）
 *     rule2 = 已识别较长文本时的短静音阈值（秒）
 *     rule3 = 单句最长时长（秒，到点强制成句）
 * - 麦克风：deviceId 为空串 = 用系统默认设备；三个布尔开关直接进 getUserMedia constraints。
 * - 任何写入都先读旧值再合并，避免丢字段。
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export type BargeMode = "auto" | "manual";
export type ModelHost = "auto" | "huggingface" | "hf-mirror";

export type VoiceSettings = {
  tts: { sid: number; speed: number; volume: number };
  asr: { rule1: number; rule2: number; rule3: number; numThreads: number };
  mic: { deviceId: string; noiseSuppression: boolean; echoCancellation: boolean; autoGainControl: boolean };
  barge: { gateDb: number; mode: BargeMode };
  modelHost: ModelHost;
  /** 按键启动：系统级快捷键（Electron globalShortcut），空串 = 关闭 */
  hotkey: { enabled: boolean; accelerator: string };
  /** 输入框语音输入快捷键：按住说话、松开发送识别结果；渲染层 keydown/up 监听 */
  dictationHotkey: { enabled: boolean; accelerator: string };
  /** 语音唤醒：持续聆听并匹配唤醒词（会持续占用 CPU，默认关） */
  wake: { enabled: boolean; phrase: string };
  /** 悬浮球：是否显示 + 是否弹出随机的短提示气泡 */
  ball: { visible: boolean; hints: boolean };
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  tts: { sid: 0, speed: 1.0, volume: 1.0 },
  asr: { rule1: 2.4, rule2: 1.2, rule3: 20, numThreads: 2 },
  mic: { deviceId: "", noiseSuppression: false, echoCancellation: true, autoGainControl: false },
  barge: { gateDb: 6, mode: "auto" },
  modelHost: "auto",
  hotkey: { enabled: false, accelerator: "Ctrl+Shift+M" },
  dictationHotkey: { enabled: false, accelerator: "Alt+Space" },
  wake: { enabled: false, phrase: "小柯小柯" },
  ball: { visible: true, hints: true },
};

export const TTS_VOICE_NAMES: Record<number, string> = {
  0: "音色 1",
  1: "音色 2",
  2: "音色 3",
  3: "音色 4",
  4: "音色 5",
};

/** 试听用的示例句——简短、含常见声韵母，能听出音色差别。 */
export const VOICE_SAMPLE_TEXT = "你好，我是你的语音助手，很高兴为你服务。";

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
  const d = DEFAULT_VOICE_SETTINGS;
  const tts = raw.tts ?? d.tts;
  const asr = raw.asr ?? d.asr;
  const mic = raw.mic ?? d.mic;
  const barge = raw.barge ?? d.barge;
  const hotkey = raw.hotkey ?? d.hotkey;
  const dictationHotkey = raw.dictationHotkey ?? d.dictationHotkey;
  const wake = raw.wake ?? d.wake;
  const ball = raw.ball ?? d.ball;
  const modelHost = raw.modelHost && MODEL_HOST_PRESETS[raw.modelHost] ? raw.modelHost : d.modelHost;
  return {
    tts: {
      sid: clampInt(tts.sid, 0, 4, d.tts.sid),
      speed: clampNum(tts.speed, 0.5, 2.0, d.tts.speed),
      volume: clampNum(tts.volume, 0, 2.0, d.tts.volume),
    },
    asr: {
      rule1: clampNum(asr.rule1, 0.4, 6.0, d.asr.rule1),
      rule2: clampNum(asr.rule2, 0.2, 4.0, d.asr.rule2),
      rule3: clampNum(asr.rule3, 3, 60, d.asr.rule3),
      numThreads: clampInt(asr.numThreads, 1, 4, d.asr.numThreads),
    },
    mic: {
      deviceId: typeof mic.deviceId === "string" ? mic.deviceId : d.mic.deviceId,
      noiseSuppression: Boolean(mic.noiseSuppression),
      echoCancellation: mic.echoCancellation !== false,
      autoGainControl: Boolean(mic.autoGainControl),
    },
    barge: {
      gateDb: clampInt(barge.gateDb, 3, 12, d.barge.gateDb),
      mode: barge.mode === "manual" ? "manual" : "auto",
    },
    hotkey: {
      enabled: Boolean(hotkey.enabled),
      accelerator: sanitizeAccelerator(hotkey.accelerator, d.hotkey.accelerator),
    },
    dictationHotkey: {
      enabled: Boolean(dictationHotkey.enabled),
      accelerator: sanitizeAccelerator(dictationHotkey.accelerator, d.dictationHotkey.accelerator),
    },
    wake: {
      enabled: Boolean(wake.enabled),
      // 唤醒词：去掉空白与控制字符，限长（太长既难识别也难念）
      phrase: String(wake.phrase ?? "").replace(/\s+/g, "").slice(0, 16) || d.wake.phrase,
    },
    ball: {
      // 隐藏后仍要留入口：右键菜单/设置页都能再打开，所以允许 false
      visible: ball.visible !== false,
      hints: ball.hints !== false,
    },
    modelHost,
  };
}

/**
 * 规范化 Electron 快捷键字符串：只保留允许的修饰键 + 单个主键，避免注册时抛错。
 * 允许 Ctrl / Shift / Alt / Super(Win/Cmd)，主键取最后一个 token。
 */
function sanitizeAccelerator(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const parts = raw.split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return fallback;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map((m) => {
    const lower = m.toLowerCase();
    if (lower === "ctrl" || lower === "control" || lower === "cmdorctrl") return "Ctrl";
    if (lower === "shift") return "Shift";
    if (lower === "alt" || lower === "option") return "Alt";
    if (lower === "super" || lower === "meta" || lower === "cmd" || lower === "win") return "Super";
    return "";
  }).filter(Boolean);
  // 必须至少有一个修饰键（否则单键快捷键会吞掉正常输入）
  if (!mods.length) return fallback;
  const allowed = /^(F([1-9]|1[0-2])|[A-Z0-9]|Space|Enter|Tab|Esc|Up|Down|Left|Right)$/i;
  const cleanKey = key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
  if (!allowed.test(cleanKey)) return fallback;
  return [...new Set(mods), cleanKey].join("+");
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
