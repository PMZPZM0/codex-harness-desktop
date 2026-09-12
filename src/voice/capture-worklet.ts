/**
 * 麦克风采集的 AudioWorklet 处理器源码（字符串常量）。
 *
 * 为什么要走 AudioWorklet 而不是 ScriptProcessorNode：后者跑在主线程上，
 * 界面一卡就丢音频块；前者在音频线程，稳定不掉帧。
 *
 * 以字符串形式提供是为了用 Blob URL 注册（`registerProcessor` 必须在
 * AudioWorkletGlobalScope 里执行），这样打包后也不依赖额外的资源文件路径。
 *
 * 输出约定：固定 1024 样本一块（16kHz 下约 64ms），必要时做线性重采样。
 * 与主线程的 resampleLinear 保持同一套算法，避免两处行为不一致。
 */
export const CAPTURE_WORKLET_SOURCE = `
var TARGET_RATE = 16000;
var BLOCK = 1024;

function resampleLinear(src, srcRate, dstRate) {
  if (srcRate === dstRate || src.length === 0) return src;
  var ratio = srcRate / dstRate;
  var outLen = Math.max(1, Math.floor(src.length / ratio));
  var out = new Float32Array(outLen);
  for (var i = 0; i < outLen; i++) {
    var pos = i * ratio;
    var i0 = Math.floor(pos);
    var i1 = Math.min(i0 + 1, src.length - 1);
    var frac = pos - i0;
    out[i] = src[i0] + (src[i1] - src[i0]) * frac;
  }
  return out;
}

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.acc = new Float32Array(0);
    this.accLen = 0;
    this.ratio = sampleRate / TARGET_RATE;
    this.need = Math.ceil(BLOCK * this.ratio);
    this.alive = true;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === "stop") this.alive = false;
    };
  }

  push(channel) {
    if (this.accLen + channel.length > this.acc.length) {
      var cap = this.acc.length > 0 ? this.acc.length : this.need * 2;
      while (cap < this.accLen + channel.length) cap *= 2;
      var next = new Float32Array(cap);
      next.set(this.acc.subarray(0, this.accLen));
      this.acc = next;
    }
    this.acc.set(channel, this.accLen);
    this.accLen += channel.length;
  }

  drain() {
    while (this.accLen >= this.need) {
      var slice = this.acc.subarray(0, this.need);
      var resampled = this.ratio === 1 ? slice.subarray(0, BLOCK) : resampleLinear(slice, sampleRate, TARGET_RATE);
      var chunk = new Float32Array(BLOCK);
      chunk.set(resampled.length >= BLOCK ? resampled.subarray(0, BLOCK) : resampled);
      this.port.postMessage(chunk, [chunk.buffer]);
      this.acc.copyWithin(0, this.need, this.accLen);
      this.accLen -= this.need;
    }
  }

  process(inputs) {
    if (!this.alive) return false;
    var input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      this.push(input[0]);
      this.drain();
    }
    return true;
  }
}

registerProcessor("voice-capture", VoiceCaptureProcessor);
`;
