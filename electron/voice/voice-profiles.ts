/**
 * 音色档案（音色克隆 / ZipVoice zero-shot）。
 *
 * 工作流：导入或录制一段参考音频 → 本机 ASR 自动转写「参考文本」→ 用户校对 → 保存为专属音色。
 * 之后合成时把 (参考音频, 参考文本) 交给 zipvoice 模型，即可用那个嗓音朗读任意文本。
 *
 * 铁律：**参考音频与文本必须成对且一致**——文本对不上，音质会明显劣化（zeroshot 模型的硬约束）。
 * 所以本模块不提供「无文本」的档案，转写失败时必须让用户手填。
 *
 * 存盘：`<userData>/voice-profiles/profiles.json`（索引）+ 同目录下的 wav 文件。
 * 音频统一规范成 16-bit PCM 单声道 wav，便于跨设备复用。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync, statSync } from "node:fs";

export type VoiceProfile = {
  id: string;
  name: string;
  /** wav 文件名（位于 profilesRoot 下） */
  audioFile: string;
  /** 参考音频里念的那句话（克隆必需） */
  refText: string;
  sampleRate: number;
  durationSec: number;
  createdAt: number;
};

const INDEX_FILE = "profiles.json";
const MAX_SECONDS = 60;

export function profilesRoot(userDataDir: string): string {
  return path.join(userDataDir, "voice-profiles");
}

export function profileAudioPath(userDataDir: string, profile: VoiceProfile): string {
  return path.join(profilesRoot(userDataDir), profile.audioFile);
}

/** 解析 16-bit PCM wav（单/多声道都会混成单声道）。非 PCM16 返回 null。 */
export function readWav(buf: Buffer): { samples: Float32Array; sampleRate: number } | null {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let offset = 12;
  let sampleRate = 0;
  let bits = 16;
  let channels = 1;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      channels = buf.readUInt16LE(offset + 10) || 1;
      sampleRate = buf.readUInt32LE(offset + 12);
      bits = buf.readUInt16LE(offset + 22);
    } else if (id === "data") {
      if (bits !== 16) return null;
      const count = Math.min(size, buf.length - offset - 8);
      const frames = Math.floor(count / 2 / channels);
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += buf.readInt16LE(offset + 8 + (i * channels + c) * 2);
        out[i] = sum / channels / 32768;
      }
      return { samples: out, sampleRate: sampleRate || 16000 };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/** 线性插值重采样（语音够用；与渲染层 voice-aec.mjs 的 resampleLinear 同算法）。 */
export function resampleLinear(src: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (!src.length || srcRate === dstRate) return src;
  const ratio = srcRate / dstRate;
  const outLen = Math.max(1, Math.floor(src.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, src.length - 1);
    const frac = pos - i0;
    out[i] = src[i0] + (src[i1] - src[i0]) * frac;
  }
  return out;
}

/** 编码 16-bit 单声道 wav。 */
export function encodeWav16(samples: Float32Array, sampleRate: number): Buffer {
  const size = samples.length;
  const buf = Buffer.alloc(44 + size * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + size * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(size * 2, 40);
  for (let i = 0; i < size; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  }
  return buf;
}

export async function listProfiles(userDataDir: string): Promise<VoiceProfile[]> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(profilesRoot(userDataDir), INDEX_FILE), "utf8"));
    const list: VoiceProfile[] = Array.isArray(raw) ? raw : Array.isArray(raw?.profiles) ? raw.profiles : [];
    // 音频文件被手工删掉的档案直接过滤掉，避免列表里出现点不开的条目
    return list.filter((p) => p?.id && p?.audioFile && existsSync(path.join(profilesRoot(userDataDir), p.audioFile)));
  } catch {
    return [];
  }
}

async function writeIndex(userDataDir: string, list: VoiceProfile[]): Promise<void> {
  await fs.mkdir(profilesRoot(userDataDir), { recursive: true });
  await fs.writeFile(path.join(profilesRoot(userDataDir), INDEX_FILE), JSON.stringify(list, null, 2), "utf8");
}

/**
 * 新建档案：把参考音频规范化成 16k~48k 的单声道 wav 落盘。
 * 返回档案记录；参考文本由调用方（导入流程）用本机 ASR 转写后传入。
 */
export async function createProfile(
  userDataDir: string,
  input: { name: string; refText: string; samples: Float32Array; sampleRate: number },
): Promise<VoiceProfile> {
  const root = profilesRoot(userDataDir);
  await fs.mkdir(root, { recursive: true });
  const trimmed = input.samples.length > input.sampleRate * MAX_SECONDS
    ? input.samples.subarray(0, Math.floor(input.sampleRate * MAX_SECONDS))
    : input.samples;
  const id = "vp" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const audioFile = id + ".wav";
  await fs.writeFile(path.join(root, audioFile), encodeWav16(trimmed, input.sampleRate));
  const profile: VoiceProfile = {
    id,
    name: input.name.trim().slice(0, 30) || "我的音色",
    audioFile,
    refText: input.refText.trim().slice(0, 500),
    sampleRate: input.sampleRate,
    durationSec: Math.round((trimmed.length / input.sampleRate) * 10) / 10,
    createdAt: Date.now(),
  };
  const list = await listProfiles(userDataDir);
  list.push(profile);
  await writeIndex(userDataDir, list);
  return profile;
}

export async function updateProfile(
  userDataDir: string,
  id: string,
  patch: { name?: string; refText?: string },
): Promise<VoiceProfile | null> {
  const list = await listProfiles(userDataDir);
  const hit = list.find((p) => p.id === id);
  if (!hit) return null;
  if (patch.name !== undefined) hit.name = patch.name.trim().slice(0, 30) || hit.name;
  if (patch.refText !== undefined) hit.refText = patch.refText.trim().slice(0, 500);
  await writeIndex(userDataDir, list);
  return hit;
}

export async function deleteProfile(userDataDir: string, id: string): Promise<boolean> {
  const list = await listProfiles(userDataDir);
  const hit = list.find((p) => p.id === id);
  if (!hit) return false;
  await writeIndex(userDataDir, list.filter((p) => p.id !== id));
  const file = path.join(profilesRoot(userDataDir), hit.audioFile);
  if (existsSync(file)) await fs.rm(file, { force: true });
  return true;
}

/** 档案音频的时长/大小（用于列表展示；文件没了返回 0）。 */
export function profileAudioBytes(userDataDir: string, profile: VoiceProfile): number {
  try {
    return statSync(profileAudioPath(userDataDir, profile)).size;
  } catch {
    return 0;
  }
}
