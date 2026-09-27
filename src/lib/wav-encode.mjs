/**
 * Float32 PCM → WAV（16-bit）的纯编码。
 *
 * 用途：本地 TTS（`voice:speak`）回的是 **Float32 采样点的 base64**，要落成能播放/能进剪辑的
 * 文件就得自己封 WAV 头。这段必须是纯函数 —— 守卫要能直接 import 跑真值表
 * （头 44 字节、RIFF/WAVE 标志、data 长度、采样率都要能验）。
 */

const HEADER_BYTES = 44;

/** 44 字节标准 WAV 头（PCM，无扩展块）。`channels` 默认 1（本地 TTS 是单声道）。 */
export function wavHeader(dataBytes, sampleRate, channels = 1, bitsPerSample = 16) {
  const buffer = new ArrayBuffer(HEADER_BYTES);
  const view = new DataView(buffer);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const ascii = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);        // fmt 块长度
  view.setUint16(20, 1, true);         // 1 = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  return new Uint8Array(buffer);
}

/**
 * base64（Float32 little-endian 采样点）→ 完整 WAV 的 base64。
 * 采样点先夹到 [-1, 1] 再量化：模型偶尔会给出略超范围的值，不夹会整数溢出成爆音。
 */
export function wavBase64FromFloat32Pcm(base64, sampleRate, channels = 1) {
  const rate = Number(sampleRate);
  if (!base64 || !Number.isFinite(rate) || rate <= 0) return "";
  const binary = atob(String(base64));
  const raw = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) raw[i] = binary.charCodeAt(i);
  // 与 src/voice/audio-transport.ts 的口径一致：字节数不是 4 的倍数时截断，别读越界
  const usable = raw.byteLength - (raw.byteLength % 4);
  const samples = usable > 0 ? new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + usable)) : new Float32Array(0);
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(HEADER_BYTES + dataBytes);
  out.set(wavHeader(dataBytes, Math.round(rate), channels, 16), 0);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] || 0));
    view.setInt16(HEADER_BYTES + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  let text = "";
  const chunk = 0x8000;
  for (let i = 0; i < out.length; i += chunk) text += String.fromCharCode.apply(null, Array.from(out.subarray(i, i + chunk)));
  return btoa(text);
}

/** 估算 WAV 时长（秒）—— 界面上不装音频库就能显示"这段配音多长"。 */
export function wavDurationSeconds(wavBase64) {
  const s = String(wavBase64 || "");
  if (!s) return 0;
  const binary = atob(s);
  if (binary.length < HEADER_BYTES) return 0;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const byteRate = view.getUint32(28, true);
  const dataBytes = view.getUint32(40, true);
  if (!byteRate) return 0;
  return Math.round((dataBytes / byteRate) * 10) / 10;
}
