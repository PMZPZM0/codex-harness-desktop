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
import { DEFAULT_VOICE_BALL_STYLE, normalizeVoiceBallStyle } from "../../src/lib/voice-ball-styles.mjs";

export type BargeMode = "auto" | "manual";
export type ModelHost = "auto" | "huggingface" | "hf-mirror";
/** 自研 NLMS 回声消除：auto=浏览器自带 AEC 关掉时才启用（避免两级 AEC 叠加）、on=总是启用、off=只用门控 */
export type AecMode = "auto" | "on" | "off";

/** 设置文件结构版本：每次「默认值语义变了、老档案需要迁移」就 +1（见 migrateSettings） */
export const VOICE_SETTINGS_VERSION = 7;

export type VoiceSettings = {
  tts: {
    sid: number; speed: number; volume: number;
    /** 10-26：合成引擎（三选一，按需下载、可并存）。缺省/未装 ⇒ 回落 vits。 */
    engine?: VoiceTtsEngine;
    /** "我的音色"档案 id；空串/缺省 = 用内置预置音色 */ profileId?: string;
    /** 合成步数（10-24 新增，2–12）。步数越多音质越清晰、合成越慢。
     *  ⛔ 单一真相源：播报 / 通话 / 试听共用这一档（播报端曾写死 2 步换延迟，实测「沙哑听不清」）。 */
    numSteps: number;
  };
  asr: { rule1: number; rule2: number; rule3: number; numThreads: number };
  mic: { deviceId: string; noiseSuppression: boolean; echoCancellation: boolean; autoGainControl: boolean };
  barge: { gateDb: number; mode: BargeMode };
  /** 自研 NLMS 的启用策略（见 AecMode）；缺省 auto */
  aec?: { mode: AecMode };
  modelHost: ModelHost;
  /** 按键启动：系统级快捷键（Electron globalShortcut），空串 = 关闭 */
  hotkey: { enabled: boolean; accelerator: string };
  /** 输入框语音输入快捷键：按住说话、松开发送识别结果；渲染层 keydown/up 监听 */
  dictationHotkey: { enabled: boolean; accelerator: string };
  /** 语音唤醒：持续聆听并匹配唤醒词（会持续占用 CPU，默认关） */
  wake: { enabled: boolean; phrase: string };
  /**
   * 语音播报（10-08 立，10-09 第二轮收成**一个总开关**）—— 把 **Codex 自己写的内容**念出来。
   *
   * 播报内容只有两个来源：
   *   · ① 模型在回复末尾写的 `voice` 播报稿（解析见 `src/lib/voice-script.mjs`）；
   *   · ② 模型主动调 `voice_announce` 插播的那句话（**显式调用，不看本开关**）。
   *
   * ⛔ 10-09 用户令「运行的正文和汇总正文不用播报了，只播报 Codex 写的内容」⇒ 原来那两个开关
   *    （`live` 正文逐句播报 / `summary` 本机压缩汇总播报）连同那两条播报来源**一起删除**：
   *    - 非通话：不再流式念正文、也不再念压缩摘要，只在回合结束念**播报稿**；
   *    - 通话：正文朗读是通话自身的链路（电话里必须把回复念出来），仍由本开关门控
   *      （关掉 = 只出字幕不出声，纯语音下指令的用法）；压缩摘要同样不再念。
   * ⛔ 语速不在这里另开一份：播报与通话共用 `tts.speed`（单一真相源，避免两处各调一次还互相打架）。
   */
  announce: { enabled: boolean };
  /** 悬浮球：是否显示 + 是否弹出随机的短提示气泡 + 安静陪伴（只表情不说话） */
  /** style = 悬浮球外观 id（目录见 src/lib/voice-ball-styles.mjs；未知值回落默认） */
  ball: { visible: boolean; hints: boolean; style: string; quiet?: boolean };
  /**
   * 已下载资源的启用状态（10-03 新增）。
   *
   * ⛔ 为什么存「设置」而不是模型目录旁边放标记文件：设置文件已有版本迁移 + 原子写 + 损坏回退，
   *    而模型目录会被 `models-uninstall` 整个删掉 ⇒ 标记文件会一起消失，"停用"状态活不过卸载。
   *    资源本身（几百 MB 文件）与状态（几十字节）**生命周期不同**，必须分开放。
   *
   * 语义三层（10-03 用户要求：启用 / 停用 / 删除）：
   *   - 缺省或 `true`  = 启用（老档案没有这个字段 ⇒ 全部启用，升级不改变任何现有行为）
   *   - `false`         = 停用：文件**保留在磁盘**，只是不被加载；随时可改回 true，无需重下
   *   - 删除是独立动作（物理删文件），与 enabled 无关
   */
  resources?: Partial<Record<VoiceResourceKind, boolean>>;
  /** 结构版本（迁移用） */
  version?: number;
};

/**
 * 可单独启用/停用/删除的已下载资源。
 *
 * - `base`：语音基础模型（识别 zipformer + 端点检测 silero + 合成 vits-zh-ll，约 270MB）
 * - `zipvoice`：音色克隆模型（156MB）
 * - `kws`：唤醒关键词模型（31MB）
 *
 * ⛔ 这里是**白名单**而不是任意字符串：主进程会拿它拼路径删文件，未登记的 kind 一律拒绝
 *    （渲染层传什么都不能越界删 `<userData>` 里的别的东西）。
 */
/* 10-26 +2：可选**合成引擎**包（按需下载、与基础模型并存，互不影响）。 */
export const VOICE_RESOURCE_KINDS = ["base", "zipvoice", "kws", "kokoro", "emotivoice"] as const;
export type VoiceResourceKind = (typeof VOICE_RESOURCE_KINDS)[number];

export function isVoiceResourceKind(v: unknown): v is VoiceResourceKind {
  return typeof v === "string" && (VOICE_RESOURCE_KINDS as readonly string[]).includes(v);
}

/** 资源的中文名（主进程回给渲染层显示，避免两边各写一份字面量）。 */
/** 合成引擎（三选一）。⛔ 单一真相源：主进程按它选模型目录。 */
export const VOICE_TTS_ENGINES = ["vits", "kokoro", "emotivoice"] as const;
export type VoiceTtsEngine = (typeof VOICE_TTS_ENGINES)[number];

/** 引擎的中文名（UI 与提示共用，避免两边各写一份字面量）。 */
export const VOICE_TTS_ENGINE_LABELS: Record<VoiceTtsEngine, string> = {
  vits: "轻量播报",
  kokoro: "自然多音色",
  emotivoice: "情感语气",
};

export const VOICE_RESOURCE_LABELS: Record<VoiceResourceKind, string> = {
  base: "语音基础模型",
  zipvoice: "音色克隆模型",
  kws: "语音唤醒模型",
  kokoro: "自然多音色模型（Kokoro）",
  emotivoice: "情感语音模型（EmotiVoice）",
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  /* ⛔ 10-21 用户令「语音播报速度默认改成 1.25×」：默认 1.0 → **1.25**。
     ⚠️ 只改这里对**已存过设置的老用户无效**（档案里存的是旧值 1.0）⇒ 同轮把
        `VOICE_SETTINGS_VERSION` +1 并在 `migrateSettings` 里按「值等于旧默认才迁移」处理
        （与 rule2 / autoGainControl 同一套做法）。用户显式调过的档位保持不动。
     ⛔ 播报与通话共用这一份（单一真相源）⇒ 通话默认语速同步变成 1.25×。 */
  tts: {
    sid: 0, speed: 1.25, volume: 1.0,
    /* 10-26：默认仍是 vits（现有行为零变化）；另两个引擎要**按需下载**后才可选。 */
    engine: "vits",
    /* ⛔ 10-24 用户报「播报声音太沙哑，听不清」：播报端为压延迟写死 **2 步**（见 use-voice-announce
       的 ANNOUNCE_NUM_STEPS 历史注释：4 步 9.4s / 2 步 4.8s），而 2 步对这个蒸馏模型就是
       明显掉音质。改成**用户可选**、默认回到模型默认质量 4 步；要更清楚可在播报卡选 8 步。 */
    numSteps: 4,
  },
  // rule2 = 已识别出文字后，尾静音超过它就算「说完了」。09-13 由 1.2 → 0.8：
  // 它是端到端延迟里**唯一纯等待**的一块（审计 ④），每轮省 0.4s，且 0.8s 仍明显长于
  // 汉语自然停顿（~0.3s），不会把长句切碎。
  asr: { rule1: 2.4, rule2: 0.8, rule3: 20, numThreads: 2 },
  // ⛔ 10-08 用户报「要很大声才录得进去」：`autoGainControl` 原先默认 **false** ⇒ 麦克风信号不做自动增益，
  //    安静环境/小声说话时电平太低，识别基本拿不到东西。改成默认 **true**（浏览器/系统的标准 AGC）。
  //    ⚠️ 只改这里对**已存过设置的老用户无效**（档案里有旧值）⇒ 同轮把 VOICE_SETTINGS_VERSION +1
  //    并在 migrateSettings 里迁移（照 rule2 那次的同一套做法）。
  mic: { deviceId: "", noiseSuppression: false, echoCancellation: true, autoGainControl: true },
  // ⛔ 10-03 用户报「自动打断太灵敏」：6dB 只比回声地板高一点，外放/键盘声都够得着。
  //    抬到 9（clamp 仍是 3–12，用户可自己调）。⚠️ 改了这里**只影响新装/未设过该项的用户** ——
  //    对已存设置的老用户真正生效的是 GATE_DEFAULTS 的 minFloor / holdBlocks（用户不可配）。
  barge: { gateDb: 9, mode: "auto" },
  aec: { mode: "auto" },
  modelHost: "auto",
  // ⛔ mac 适配（09-17 审计）：默认呼叫键原来写死 "Ctrl+Shift+M"。Electron 的 accelerator 里
  //    CommandOrControl 在 Windows/Linux = Ctrl（与旧行为完全一致）、在 macOS = ⌘ —— mac 用户
  //    按 ⌘⇧M 才符合直觉，写死 Ctrl 等于给 mac 用户埋一个「默认键按不出来」的坑。
  hotkey: { enabled: false, accelerator: "CommandOrControl+Shift+M" },
  dictationHotkey: { enabled: false, accelerator: "Alt+Space" },
  wake: { enabled: false, phrase: "小柯小柯" },
  // 10-09 第二轮：`announce` 收成一个总开关。默认 **true** —— 与旧结构里 `live` 的默认一致
  // （旧默认就是「播报开着」），升级不改老用户的开关状态，只改「念什么」（念播报稿，不再念正文/摘要）。
  announce: { enabled: true },
  ball: { visible: true, hints: true, style: DEFAULT_VOICE_BALL_STYLE, quiet: false },
  // 10-03：资源默认全部启用（老档案缺这个字段时也是这个效果 ⇒ 升级不改变任何现有行为）
  resources: {},
  version: VOICE_SETTINGS_VERSION,
};

export const TTS_VOICE_NAMES: Record<number, string> = {
  0: "音色 1",
  1: "音色 2",
  2: "音色 3",
  3: "音色 4",
  4: "音色 5",
};

/**
 * Kokoro v1.1-zh 的 **103 个音色**（sid = 索引，顺序与官方 `voices.bin` 严格一致）。
 *
 * ⛔ 顺序不能改：voice id 是从模型 ONNX 元数据 `speaker_names` 里逐条抠出来的
 *    （sherpa-onnx 的 C++ 侧同样按这个顺序读 `voices.bin`）⇒ 顺序错位 = 名字与声音对不上。
 *    实测：103 条，与模型元数据 n_speakers=103 一致。
 *
 * ⛔ 名字里只标前缀不标性别：`zf_` / `zm_` 的性别归属**没有权威文档**，
 *    本机实测基频（F0 自相关）区分度不可靠 ⇒ UI 一律不写"女声/男声"，只给原始 id。
 */
export const KOKORO_VOICE_NAMES: Record<number, string> = {
  0: "af_maple",
  1: "af_sol",
  2: "bf_vale",
  3: "zf_001",
  4: "zf_002",
  5: "zf_003",
  6: "zf_004",
  7: "zf_005",
  8: "zf_006",
  9: "zf_007",
  10: "zf_008",
  11: "zf_017",
  12: "zf_018",
  13: "zf_019",
  14: "zf_021",
  15: "zf_022",
  16: "zf_023",
  17: "zf_024",
  18: "zf_026",
  19: "zf_027",
  20: "zf_028",
  21: "zf_032",
  22: "zf_036",
  23: "zf_038",
  24: "zf_039",
  25: "zf_040",
  26: "zf_042",
  27: "zf_043",
  28: "zf_044",
  29: "zf_046",
  30: "zf_047",
  31: "zf_048",
  32: "zf_049",
  33: "zf_051",
  34: "zf_059",
  35: "zf_060",
  36: "zf_067",
  37: "zf_070",
  38: "zf_071",
  39: "zf_072",
  40: "zf_073",
  41: "zf_074",
  42: "zf_075",
  43: "zf_076",
  44: "zf_077",
  45: "zf_078",
  46: "zf_079",
  47: "zf_083",
  48: "zf_084",
  49: "zf_085",
  50: "zf_086",
  51: "zf_087",
  52: "zf_088",
  53: "zf_090",
  54: "zf_092",
  55: "zf_093",
  56: "zf_094",
  57: "zf_099",
  58: "zm_009",
  59: "zm_010",
  60: "zm_011",
  61: "zm_012",
  62: "zm_013",
  63: "zm_014",
  64: "zm_015",
  65: "zm_016",
  66: "zm_020",
  67: "zm_025",
  68: "zm_029",
  69: "zm_030",
  70: "zm_031",
  71: "zm_033",
  72: "zm_034",
  73: "zm_035",
  74: "zm_037",
  75: "zm_041",
  76: "zm_045",
  77: "zm_050",
  78: "zm_052",
  79: "zm_053",
  80: "zm_054",
  81: "zm_055",
  82: "zm_056",
  83: "zm_057",
  84: "zm_058",
  85: "zm_061",
  86: "zm_062",
  87: "zm_063",
  88: "zm_064",
  89: "zm_065",
  90: "zm_066",
  91: "zm_068",
  92: "zm_069",
  93: "zm_080",
  94: "zm_081",
  95: "zm_082",
  96: "zm_089",
  97: "zm_091",
  98: "zm_095",
  99: "zm_096",
  100: "zm_097",
  101: "zm_098",
  102: "zm_100",
};

/**
 * 按当前引擎取音色表（**单一真相源**：UI 看到的音色名必须与引擎对得上）。
 *
 * - vits：5 个预置音色（`TTS_VOICE_NAMES`）
 * - kokoro：103 个音色（`KOKORO_VOICE_NAMES`）
 * - emotivoice：目前不可用（缺 ONNX 推理运行时）⇒ 回落到 vits 的表，别给用户空列表
 */
export function ttsVoiceNamesFor(engine: VoiceTtsEngine | undefined): Record<number, string> {
  if (engine === "kokoro") return KOKORO_VOICE_NAMES;
  return TTS_VOICE_NAMES;
}

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
    const migrated = migrateSettings(raw);
    // 迁移过就落盘一次（不然每次读都要再算一遍，且用户看不出档案已被升级）
    if (migrated.changed) writeFileSync(file, JSON.stringify(migrated.settings, null, 2), "utf8");
    return migrated.settings;
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

/**
 * 老档案迁移。**为什么必须有**：`loadVoiceSettings` 读的是文件里的值，
 * 只改 `DEFAULT_VOICE_SETTINGS` 对**已存在档案**（第一次运行时就写下了旧默认值）完全无效——
 * 用户永远停在旧默认上，改了个寂寞。
 *
 * v2（2026-09-13）：`asr.rule2` 默认 1.2 → 0.8。只有「还是旧默认值」的档案才跟着改；
 * 用户自己调过的值（≠1.2）一律保留。
 */
export function migrateSettings(raw: Partial<VoiceSettings> | undefined): { settings: VoiceSettings; changed: boolean } {
  const source: Partial<VoiceSettings> = raw && typeof raw === "object" ? { ...raw } : {};
  let changed = false;
  const version = Number((source as any).version ?? 1);
  if (version < 2) {
    const rule2 = Number(source.asr?.rule2);
    if (!Number.isFinite(rule2) || Math.abs(rule2 - 1.2) < 1e-9) {
      source.asr = { ...(source.asr as any), rule2: DEFAULT_VOICE_SETTINGS.asr.rule2 };
      changed = true;
    }
  }
  /* v2 → v3（10-08）：`mic.autoGainControl` 的默认值由 false 改成 true（用户报「要很大声才录得进去」）。
     ⛔ 老档案里存的是旧默认 false，只改常量对他们无效 ⇒ 与上面 rule2 同一套判据：
       **值等于旧默认**（false 或没写过）才迁移；用户显式设过 true 的本来就对，不动。
     ⚠️ 取舍说清楚：布尔量**无法区分**「当年是默认值」与「用户显式关掉」（档案里都只是一个 false）
       ⇒ 显式关过 AGC 的用户（例如嫌增益把环境噪声也放大）也会被改回 true。这是有意的取舍：
       默认关着会让「正常音量识别不到」这类问题落到所有人头上，代价远大于少数人需要重新关一次。 */
  if (version < 3) {
    if (source.mic?.autoGainControl !== true) {
      source.mic = { ...(source.mic as any), autoGainControl: true };
      changed = true;
    }
  }
  /* v3 → v4（10-09 第二轮）：`announce` 由两个开关（`live` 正文逐句 / `summary` 本机压缩汇总）
     **收成一个** `enabled`（用户令：「运行的正文和汇总正文不用播报了，只播报 Codex 写的内容」）。
     ⛔ 老档案里是 `{live, summary}`、没有 `enabled` ⇒ 不迁移的话这个字段读出来是 undefined。
        判据：**任一为真即视为播报开着**（旧默认 live=true 正是「开着」，别把老用户的开关状态丢掉）。
     ⛔ 念的东西变了（正文/摘要 → Codex 写的播报稿）是用户明确要的行为变更，不是迁移失误；
        这里只负责把「开/关」这个状态平移过来。 */
  if (version < 4) {
    const a: any = (source as any).announce;
    if (a && typeof a.enabled !== "boolean") {
      (source as any).announce = { enabled: a.live !== false || a.summary === true };
      changed = true;
    }
  }
  /* v4 → v5（10-21）：`tts.speed` 默认值 1.0 → **1.25**（用户令「语音播报速度默认改成 1.25×」）。
     ⛔ 判据与 rule2 同型：**值缺失或仍等于旧默认 1.0** 才迁移；用户显式调过的档位（0.75 / 1.5 / 2 …）
       保持不动。⚠️ 无法区分「用户手动设成 1.0」与「从未设过」——两者都会被迁到 1.25（有意取舍：
       1.25 更接近用户想要的默认听感，想回 1.0 一档点回即可；反之留 1.0 等于这次默认值改动对所有人无效）。
     ⛔ 单一真相源：播报与通话共用 `tts.speed` ⇒ 通话默认也跟着变，不另开字段。 */
  if (version < 5) {
    const speed = Number(source.tts?.speed);
    if (!Number.isFinite(speed) || Math.abs(speed - 1.0) < 1e-9) {
      source.tts = { ...(source.tts as any), speed: DEFAULT_VOICE_SETTINGS.tts.speed };
      changed = true;
    }
  }
  /* 10-08 新增 `announce`（语音播报两个开关）**故意不 +1 版本**：这是**新增字段**、不是
     「旧默认值变了」—— 老档案里没有它，`mergeSettings` 会填上新默认（live=true 正好等于
     既有通话行为、summary=false 不引入新声音）⇒ 升级不改变任何现有体验，无需迁移。
     ⛔ 反过来才需要迁移：像上面两条那样「字段已存在、只是默认值换了」——那时老档案里存的是旧值，
       只改常量对他们完全无效（`loadVoiceSettings` 读的是文件里的值）。 */
  /* v5 → v6（10-24）：`tts.numSteps` 新增（缺省 4 = 模型默认音质）。
     ⛔ 这是**新增字段**、不是旧默认值变了，`mergeSettings` 本来就能填默认值 —— 但这里仍显式迁移一次：
        老档案（version 5）若被人手改过/写过 null，`clampInt(null)` 会静默落到默认，看不出问题；
        显式置位能让「升级后播报音质确实变好了」这件事在档案里可验证（用户报的是听感，最难归因）。 */
  if (version < 6) {
    const steps = Number(source.tts?.numSteps);
    if (!Number.isFinite(steps)) {
      source.tts = { ...(source.tts as any), numSteps: DEFAULT_VOICE_SETTINGS.tts.numSteps };
      changed = true;
    }
  }
  /* v6 → v7（10-25 用户令：「总开关默认开着就行，然后就会话级独立播报」）：
     总开关不再作为日常控制（用户会把它跟会话级 📢 搞混：看起来开着、实际总开关是关的，
     模型说关闭还被当成 bug）。档案里存着 false 的一律迁回 true；**真正的控制 = 每个会话的 📢**
     （会话静音仍然独立持久，下一轮作用域块会写「已关闭」）。
     ⚠️ 取舍：无法区分「用户显式关掉总开关」与「历史遗留 false」—— 两者都会被打开一次；
        不想要的话在设置 → 语音里再关即可（但图标与注入会同步显示关闭，不会再出现视觉矛盾）。 */
  if (version < 7) {
    if (source.announce?.enabled !== true) {
      source.announce = { enabled: true };
      changed = true;
    }
  }
  const settings = mergeSettings(source);
  if (Number(settings.version ?? 0) !== VOICE_SETTINGS_VERSION) {
    settings.version = VOICE_SETTINGS_VERSION;
    changed = true;
  }
  return { settings, changed };
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
  /* ⛔ 显式字段映射（本文件第 N 次踩同款坑：显式映射漏字段 = 用户改了不生效、且不报错）。
     10-09 第二轮：单开关 `enabled`，缺省 true（播报开着）。⛔ 兼容老档案的 `{live, summary}` ——
     直接读 `.enabled` 会拿到 undefined，老用户一进设置页就把开关"看成关着的"。 */
  const announceRaw: any = (raw as any).announce ?? d.announce;
  const announceEnabled = typeof announceRaw?.enabled === "boolean"
    ? announceRaw.enabled
    : (announceRaw?.live !== false || announceRaw?.summary === true);   // 旧档案 {live, summary}：任一为真即开着
  const ball = raw.ball ?? d.ball;
  const modelHost = raw.modelHost && MODEL_HOST_PRESETS[raw.modelHost] ? raw.modelHost : d.modelHost;
  /* ⛔ 引擎必须**归一化**：老档案没有这个字段 ⇒ 回落 vits（现有行为零变化）；
     写了不认识的值 ⇒ 也回落 vits，绝不把垃圾值透传给合成层。 */
  const engine: VoiceTtsEngine =
    VOICE_TTS_ENGINES.includes((tts as any).engine) ? (tts as any).engine : d.tts.engine!;
  const aecMode = (raw as any).aec?.mode;
  return {
    tts: {
      /* ⛔ sid 的上界**跟着引擎走**：vits 只有 5 个说话人（0–4），Kokoro 有 103 个（0–102）。
         用固定上界 4 ⇒ 选了 Kokoro 的第 50 个音色会被静默夹回 4 = "改了不生效"。
         （10-26 加引擎时的同款坑：显式字段映射把新字段/新范围吞掉。） */
      sid: clampInt(tts.sid, 0, engine === "kokoro" ? 102 : 4, d.tts.sid),
      speed: clampNum(tts.speed, 0.5, 2.0, d.tts.speed),
      volume: clampNum(tts.volume, 0, 2.0, d.tts.volume),
      /* 2 步是「能听清但发沙」的下限，12 步再往上只增延迟不给音质 ⇒ 夹在 2–12 */
      numSteps: clampInt(tts.numSteps, 2, 12, d.tts.numSteps),
      // profileId 必须显式透传：这里是显式字段映射，漏写 = 「选用克隆音色后设置不持久，
      // 通话一直用内置音色」（09-12「显式字段映射吞新字段」同款坑，voice-presets 验收抓到）
      ...(typeof tts.profileId === "string" ? { profileId: tts.profileId } : {}),
      /* ⛔ engine 同理必须显式透传：漏了 = 用户选了 Kokoro、设置里根本没这一项，
         刷新后回落到 vits（表现为"切了没反应"）。 */
      ...(VOICE_TTS_ENGINES.includes(engine) ? { engine } : {}),
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
      /* 10-25：外观 id 走共享目录校验；旧档案没有这个字段 ⇒ normalize 回落默认。 */
      style: normalizeVoiceBallStyle((ball as any).style),
      /* 10-29 安静陪伴：只表情不说话。缺省 false（老档案没有这个字段 = 照旧弹气泡）。 */
      quiet: (ball as any).quiet === true,
    },
    // ⛔ 显式字段映射（本文件第 N 次踩同款坑：显式映射漏字段 = 用户改了不生效、且不报错）。
    //    10-09 第二轮：单开关 `enabled`（缺省 true = 播报开着；老档案的 {live, summary} 已在上面平移）。
    announce: { enabled: announceEnabled },
    aec: { mode: aecMode === "on" || aecMode === "off" ? aecMode : d.aec!.mode },
    modelHost,
    // ⛔ 必须显式透传（10-03）：这里是显式字段映射，漏写 resources 的后果是
    //    「用户点了停用 → 保存 → 下次读回来又是启用」，而且**不报任何错**。
    //    同款坑：09-12 profileId 被吞、09-12 zipvoice 状态被吞。
    resources: mergeResources(raw.resources),
    version: VOICE_SETTINGS_VERSION,
  };
}

/**
 * 规范化资源启用状态：**只保留白名单里的 kind**，且值严格归一为布尔。
 *
 * 过滤未登记 kind 的原因：这份 JSON 用户可手改，而它会被主进程用来决定
 * 「这个资源启不启用」。留未知 key 不会造成越界（消费侧只按 kind 查），
 * 但会让文件越攒越脏、也让「读回来等于写进去」这条判据失效。
 */
function mergeResources(raw: unknown): Partial<Record<VoiceResourceKind, boolean>> {
  const out: Partial<Record<VoiceResourceKind, boolean>> = {};
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const kind of VOICE_RESOURCE_KINDS) {
    if (Object.prototype.hasOwnProperty.call(src, kind)) out[kind] = src[kind] !== false;
  }
  return out;
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

/**
 * 某个已下载资源当前是否启用（10-03）。
 *
 * ⛔ **缺省 = 启用**：`resources[kind] !== false`。老档案没有这个字段，
 *    迁移后也是启用 ⇒ 升级不改变任何现有行为（这条是本功能的兼容底线）。
 */
export function isVoiceResourceEnabled(settings: VoiceSettings, kind: VoiceResourceKind): boolean {
  return settings.resources?.[kind] !== false;
}

/** 停用某个资源（不碰磁盘上的文件）。返回合并后的完整设置。 */
export function setVoiceResourceEnabled(
  userDataDir: string,
  kind: VoiceResourceKind,
  enabled: boolean
): VoiceSettings {
  const current = loadVoiceSettings(userDataDir);
  const resources = { ...(current.resources ?? {}), [kind]: enabled };
  return saveVoiceSettings(userDataDir, { resources });
}

/** 把三种资源状态回给渲染层：是否启用 + 是否已下载（两者正交，四种组合都有意义）。 */
export function voiceResourceStates(settings: VoiceSettings): Record<VoiceResourceKind, { enabled: boolean; label: string }> {
  const out = {} as Record<VoiceResourceKind, { enabled: boolean; label: string }>;
  for (const kind of VOICE_RESOURCE_KINDS) {
    out[kind] = { enabled: isVoiceResourceEnabled(settings, kind), label: VOICE_RESOURCE_LABELS[kind] };
  }
  return out;
}

