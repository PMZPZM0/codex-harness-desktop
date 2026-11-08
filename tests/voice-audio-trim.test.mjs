/** TTS 尾部裁剪真值表（11-08「播报结束后电流声还响几秒」的判据）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { trimTtsSamples, TTS_TRIM_ABS_FLOOR } from "../src/lib/voice-audio-trim.mjs";

const RATE = 22050;

function noise(len, amp, seed = 1) {
  const out = new Float32Array(len);
  let x = seed;
  for (let i = 0; i < len; i += 1) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out[i] = ((x / 0xffffffff) * 2 - 1) * amp;
  }
  return out;
}

function tone(len, amp, freq = 220) {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i += 1) out[i] = Math.sin((2 * Math.PI * freq * i) / RATE) * amp;
  return out;
}

function concat(...parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

test("尾部低电平噪声被砍掉（播报结束不再有电流声）", () => {
  const speech = tone(Math.round(RATE * 0.4), 0.25);
  const tailNoise = noise(Math.round(RATE * 2.5), 0.0006, 7);
  const input = concat(speech, tailNoise);
  const out = trimTtsSamples(input, RATE);
  assert.ok(out.length > RATE * 0.35, "语音本身要保留");
  assert.ok(out.length < RATE * 0.8, `尾巴应被砍掉（实际 ${(out.length / RATE).toFixed(2)}s）`);
  assert.ok(Math.abs(out[out.length - 1]) < 1e-6, "结尾必须淡到 0（防截断爆音）");
  assert.ok(Math.abs(out[0]) < 1e-6, "开头同样淡入");
});

test("头部静音/噪声也去掉（开口不先「哒」一下）", () => {
  const lead = noise(Math.round(RATE * 0.5), 0.0004, 3);
  const speech = tone(Math.round(RATE * 0.3), 0.2);
  const out = trimTtsSamples(concat(lead, speech), RATE);
  assert.ok(out.length < RATE * 0.5, "前导噪声应被砍掉");
  assert.ok(out.length > RATE * 0.25, "语音保留");
});

test("轻声收尾（高于地板）不被误砍", () => {
  const speech = tone(Math.round(RATE * 0.3), 0.2);
  const soft = tone(Math.round(RATE * 0.15), 0.02, 330);
  const out = trimTtsSamples(concat(speech, soft), RATE);
  assert.ok(out.length > RATE * 0.4, "轻声尾音要保留");
});

test("整段都是噪声 ⇒ 返回空（直接不播）", () => {
  const out = trimTtsSamples(noise(RATE, TTS_TRIM_ABS_FLOOR / 4, 9), RATE);
  assert.equal(out.length, 0);
});

test("本身干净的语音不被吃掉", () => {
  const speech = tone(Math.round(RATE * 0.5), 0.2);
  const out = trimTtsSamples(speech, RATE);
  assert.ok(out.length >= Math.round(RATE * 0.45), "不能把正常语音裁短一大截");
});

test("空输入 / 非 Float32Array 安全返回", () => {
  assert.equal(trimTtsSamples(null, RATE).length, 0);
  assert.equal(trimTtsSamples(new Float32Array(0), RATE).length, 0);
});

test("整体低于能量地板（只有零星毛刺）⇒ 原样返回，不砍成最后 10ms", () => {
  const RATE2 = 22050;
  const quiet = new Float32Array(RATE2);
  for (let i = 0; i < quiet.length; i += 1) quiet[i] = i % 500 === 0 ? 0.01 : 0; // 稀疏毛刺，窗口 RMS 仍低于地板
  const out = trimTtsSamples(quiet, RATE2);
  assert.equal(out.length, quiet.length, "找不到语音窗时应保留整段（否则轻声音频被砍成 30ms）");
});
