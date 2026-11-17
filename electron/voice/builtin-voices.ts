/**
 * 内置参考音色（11-17 用户令「每个语音模型都要有音色选择」；混合方案：
 * Chatterbox 用它自带的默认音色，其余克隆引擎用本机模型 5 个真实说话人生成参考样本）。
 *
 * ⛔ 为什么不是「假装内置」：GPT-SoVITS / F5 / IndexTTS2 / CosyVoice(这颗权重) 都是零样本克隆引擎，
 *   上游没有内置说话人 —— 不给参考音频它们根本合不出声。用本机 vits 的 5 个说话人合成一段
 *   参考音频，外部引擎克隆这段声音，**听感就是那个说话人**，并且不需要用户自己录。
 *   Chatterbox 例外：模型自带 `conds.pt` 默认音色（无参考也能生成），所以它给「默认音色」原生项。
 *
 * ⛔ 生成只在第一次需要时做（每音色一句 ~7 秒），落盘后永久复用；模型换了（说话人名变了）
 *   以说话人名为准重新生成（文件名带名字，换模型自然换文件）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 参考句：够长（>3 秒，GPT-SoVITS 硬要求；实测约 7~9 秒）且含常见声韵母。 */
export const BUILTIN_REF_TEXT = "你好，我是你的语音助手。今天天气不错，我们把这件事认真做完，再一起检查一遍，好不好？";

export type BuiltinVoice = { sid: number; name: string; audioPath: string; refText: string };

/** 随包默认音色（resources/voice-presets/presets.json + wav）：不依赖本机基础模型，装上引擎就能出声。 */
export type BundledVoice = { id: string; name: string; desc: string; lang: string; audioPath: string; refText: string };

/** 随包音色目录：开发版用项目 resources/，打包版用 process.resourcesPath/（与 VoicePresetsSection 同一规则）。 */
export function voicePresetsDir(): string {
  const dev = join(process.cwd(), "resources", "voice-presets");
  if (existsSync(dev)) return dev;
  return join(process.resourcesPath ?? process.cwd(), "voice-presets");
}

/** 读随包默认音色（音频缺失/参考文本为空的条目自动跳过）。 */
export function listBundledVoices(): BundledVoice[] {
  const dir = voicePresetsDir();
  try {
    const raw = JSON.parse(readFileSync(join(dir, "presets.json"), "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((preset: any) => preset?.id && preset?.name && preset?.wav && String(preset?.refText ?? "").trim())
      .map((preset: any) => ({
        id: String(preset.id),
        name: String(preset.name),
        desc: String(preset.desc ?? ""),
        lang: String(preset.lang ?? "zh"),
        audioPath: join(dir, String(preset.wav)),
        refText: String(preset.refText).trim(),
      }))
      .filter((voice) => existsSync(voice.audioPath));
  } catch { return []; }
}

/** 按 id 取一个随包默认音色（外部引擎的 preset:<id> 选择）。 */
export function readBundledVoice(id: string): BundledVoice | null {
  return listBundledVoices().find((voice) => voice.id === id) ?? null;
}

type BuiltinMeta = { version: 1; refText: string; voices: { sid: number; name: string; file: string }[] };

/** 内置参考样本目录（userData 下，卸载重装不丢；体积每音色 ~200KB）。 */
export function builtinVoicesDir(userData: string): string {
  return join(userData, "voice-presets", "builtin");
}

function metaPath(userData: string): string {
  return join(builtinVoicesDir(userData), "meta.json");
}

/** 读元数据（音色不依赖模型路径：外部引擎播报时只认 userData）。 */
function readMeta(userData: string): BuiltinMeta | null {
  try {
    const meta: BuiltinMeta = JSON.parse(readFileSync(metaPath(userData), "utf8"));
    return meta?.version === 1 && Array.isArray(meta.voices) ? meta : null;
  } catch { return null; }
}

function safeName(value: unknown, sid: number): string {
  return String(value || `sid${sid}`).replace(/[^\w.-]+/g, "_");
}

function builtinPath(userData: string, sid: number, name: string): string {
  return join(builtinVoicesDir(userData), `${sid}-${safeName(name, sid)}.wav`);
}

/** 已生成的参考样本（meta 为准；文件被删掉的条目自动跳过）。 */
export function listBuiltinVoices(userData: string): BuiltinVoice[] {
  const meta = readMeta(userData);
  if (!meta) return [];
  return meta.voices
    .filter((v) => Number.isInteger(v.sid) && v.sid >= 0)
    .sort((a, b) => a.sid - b.sid)
    .map((v) => ({ sid: v.sid, name: String(v.name), audioPath: join(builtinVoicesDir(userData), v.file), refText: meta.refText || BUILTIN_REF_TEXT }))
    .filter((v) => existsSync(v.audioPath));
}

/** 读一个内置参考音色（外部引擎播报时用）；不存在返回 null。 */
export function readBuiltinVoice(userData: string, sid: number): BuiltinVoice | null {
  return listBuiltinVoices(userData).find((v) => v.sid === sid) ?? null;
}

/** 清理旧模型遗留的样本（说话人名对不上的），避免目录里堆死文件。⛔ 只删本目录下的 .wav。 */
function pruneStale(dir: string, keep: Set<string>): void {
  try {
    for (const file of readdirSync(dir)) {
      if (!file.toLowerCase().endsWith(".wav")) continue;
      if (!keep.has(file)) { try { unlinkSync(join(dir, file)); } catch { /* 忽略 */ } }
    }
  } catch { /* 目录不存在 */ }
}

/** Float32 单声道样本 → 16 位 PCM WAV（参考音频只进外部引擎，不需要 24bit）。 */
function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const frames = samples.length;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + frames * 2, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buffer;
}

/**
 * 确保「当前模型 5 个说话人」的参考样本都在盘上；缺的用注入的合成函数现生成。
 * ⛔ 合成函数必须用**本机 vits**（不能走外部引擎，否则会自我循环）。
 * 单个音色失败不拖垮整批：跳过并在结果里记下失败的 sid。
 */
export async function ensureBuiltinVoices(options: {
  userData: string;
  names: Record<number, string>;
  synthesize: (sid: number) => Promise<{ sampleRate: number; samples: Float32Array }>;
}): Promise<{ voices: BuiltinVoice[]; failed: number[] }> {
  const { userData, names, synthesize } = options;
  const dir = builtinVoicesDir(userData);
  mkdirSync(dir, { recursive: true });
  const failed: number[] = [];
  const wanted = Object.entries(names)
    .map(([key, name]) => ({ sid: Number(key), name: String(name) }))
    .filter((v) => Number.isInteger(v.sid) && v.sid >= 0)
    .sort((a, b) => a.sid - b.sid);
  pruneStale(dir, new Set(wanted.map((v) => `${v.sid}-${safeName(v.name, v.sid)}.wav`)));
  for (const voice of wanted) {
    const target = builtinPath(userData, voice.sid, voice.name);
    if (existsSync(target)) continue;
    try {
      const { sampleRate, samples } = await synthesize(voice.sid);
      if (!samples?.length) throw new Error("合成结果为空");
      writeFileSync(target, encodeWav(samples, sampleRate || 16000));
    } catch { failed.push(voice.sid); }
  }
  /* meta.json 是「有哪些内置音色」的单一真相源（外部引擎播报只认 userData，不依赖模型路径）。
     ⛔ 11-17 修复：只登记**文件真的在盘上**的条目 —— 旧实现把生成失败的 sid 也写进 meta，
     列表又按 existsSync 过滤 ⇒ 界面上一个默认音色都没有（用户实测「音色列表是空的」）。 */
  writeFileSync(metaPath(userData), JSON.stringify({
    version: 1,
    refText: BUILTIN_REF_TEXT,
    voices: wanted
      .filter((v) => existsSync(builtinPath(userData, v.sid, v.name)))
      .map((v) => ({ sid: v.sid, name: v.name, file: `${v.sid}-${safeName(v.name, v.sid)}.wav` })),
  }, null, 2), "utf8");
  return { voices: listBuiltinVoices(userData), failed };
}
