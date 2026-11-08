/**
 * TTS 播放前的尾部裁剪（11-08 用户实测：只开「语音播报」也能复现 ——
 * 播报文字已经念完，扬声器还持续几秒「电流/嗡嗡」声）。
 *
 * 根因：ZipVoice / VITS 合成出来的样本里，语音结束后常挂一段**低电平噪声尾巴**
 * （声码器收尾 + DC 残余）。播放端把整段 buffer 交给 AudioContext ⇒ 用户听到的就是
 * 「话停了、电流声还在」，直到 buffer 真正播完（几秒）。
 *
 * 做法：按「窗口能量」找真正的语音尾 —— 从两端按 10ms 窗口往里走，窗口 RMS 低于
 * `max(绝对地板, 全段 RMS × 6%)` 就当作噪声砍掉；保留 120ms 尾巴余量（轻声收尾的
 * 气声不被切掉），再给两端 30ms 淡入/淡出（避免直接截断的「哒」声）。
 *
 * ⛔ 这是纯函数（无 DOM / 无 AudioContext），真值表在 tests/voice-audio-trim.test.mjs。
 * ⛔ 阈值保守（只砍明显低于平均人声的尾巴）：宁可少砍一点，也不能把词尾吃掉。
 */

/** 绝对地板（≈ -50 dBFS）：再安静的环境/录音也有底噪，低于它不可能是人声。 */
export const TTS_TRIM_ABS_FLOOR = 0.0032;
/** 相对地板：低于全段平均能量 6%（≈ -24 dB）的窗口视为噪声。 */
export const TTS_TRIM_REL_FLOOR = 0.06;
export const TTS_TRIM_WINDOW_MS = 10;
export const TTS_TRIM_PAD_HEAD_MS = 20;
export const TTS_TRIM_PAD_TAIL_MS = 120;
export const TTS_TRIM_FADE_MS = 30;

function rmsOfWindow(samples, from, to) {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += samples[i] * samples[i];
  const n = Math.max(1, to - from);
  return Math.sqrt(sum / n);
}

/**
 * @param {Float32Array} samples 合成样本（-1..1）
 * @param {number} sampleRate
 * @returns {Float32Array} 裁剪后的新数组；整段都是噪声时返回长度 0（调用方直接跳过播放）
 */
export function trimTtsSamples(samples, sampleRate = 22050) {
  const src = samples instanceof Float32Array ? samples : new Float32Array(0);
  const n = src.length;
  const rate = Number(sampleRate) > 0 ? Number(sampleRate) : 22050;
  if (!n) return src;

  let peak = 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const v = Math.abs(src[i]);
    if (v > peak) peak = v;
    sum += src[i] * src[i];
  }
  const globalRms = Math.sqrt(sum / n);
  /* ⛔ 全段本来就是静音/纯噪声（peak 都到不了绝对地板）⇒ 别播放，直接返回空。 */
  if (peak < TTS_TRIM_ABS_FLOOR) return new Float32Array(0);
  const floor = Math.max(TTS_TRIM_ABS_FLOOR, globalRms * TTS_TRIM_REL_FLOOR);
  const win = Math.max(1, Math.round((rate * TTS_TRIM_WINDOW_MS) / 1000));

  /* 从头找第一块「有能量」的窗口。⛔ 一块都没有（整体极轻、只有零星毛刺）：原样返回，
     绝不因为「找不到语音」就只留最后 10ms + 余量（那会把一段轻声音乐/气声砍成 30ms）。 */
  let firstEnergetic = -1;
  for (let w = 0; (w + 1) * win <= n; w += 1) {
    if (rmsOfWindow(src, w * win, (w + 1) * win) >= floor) { firstEnergetic = w; break; }
  }
  if (firstEnergetic < 0) return src;
  const headWin = firstEnergetic;
  /* 从尾找最后一块「有能量」的窗口。 */
  let tailWin = Math.floor((n - 1) / win);
  while (tailWin > headWin && rmsOfWindow(src, tailWin * win, Math.min(n, (tailWin + 1) * win)) < floor) tailWin -= 1;

  const padHead = Math.round((rate * TTS_TRIM_PAD_HEAD_MS) / 1000);
  const padTail = Math.round((rate * TTS_TRIM_PAD_TAIL_MS) / 1000);
  const from = Math.max(0, headWin * win - padHead);
  const to = Math.min(n, Math.min(n, (tailWin + 1) * win) + padTail);
  if (to <= from) return new Float32Array(0);

  const out = src.slice(from, to);
  const fade = Math.min(Math.round((rate * TTS_TRIM_FADE_MS) / 1000), Math.floor(out.length / 2));
  for (let i = 0; i < fade; i += 1) {
    const k = i / fade;
    out[i] *= k;
    out[out.length - 1 - i] *= k;
  }
  return out;
}
