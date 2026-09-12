/**
 * 语音通话的渲染层纯逻辑：线性重采样 + NLMS 回声消除 + 回声门控/双讲判定。
 *
 * 为什么这些放在渲染层：回声消除需要「正在播放的音频」作为参考信号，
 * 而播放发生在渲染层。放在这里可以拿到**采样对齐**的参考，且省掉一轮 IPC 往返。
 *
 * 全部为零依赖纯函数/纯状态机，`scripts/check-preflight.mjs` 直接 import 跑断言。
 * 算法与 dsh-voice-mode（MIT）的 NlmsAec 等价。
 */

/** 线性插值重采样（语音场景足够；重采样质量不是瓶颈，识别模型自带鲁棒性）。 */
export function resampleLinear(src, srcRate, dstRate) {
  if (!src || src.length === 0) return src instanceof Float32Array ? src : new Float32Array(0);
  if (srcRate === dstRate) return src;
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

/** 均方根（能量）。 */
export function rmsOf(samples) {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

const AEC_DEFAULTS = {
  filterLength: 256,
  delay: 64,
  step: 0.1,
  epsilon: 1e-6,
};

const MIN_REF_NORM = 1e-6;

/**
 * NLMS 自适应回声消除。
 *
 * 参考信号（扬声器在放的内容）比麦克风块短时补零——播放结束的那一块必然更短。
 * `setFrozen(true)` 暂停权重自适应（双讲期间），此时**仍照常做回声相减**，
 * 只是不再更新滤波器，防止用户语音把滤波器带偏。
 */
export function createAec(options = {}) {
  const filterLength = options.filterLength ?? AEC_DEFAULTS.filterLength;
  const delay = options.delay ?? AEC_DEFAULTS.delay;
  const mu = options.step ?? AEC_DEFAULTS.step;
  const eps = options.epsilon ?? AEC_DEFAULTS.epsilon;
  const w = new Float32Array(filterLength);
  const xBuf = new Float32Array(delay + filterLength);
  let cursor = 0;
  let filled = 0;
  let frozen = false;

  return {
    setFrozen(next) {
      frozen = Boolean(next);
    },
    /** 送入一块麦克风与对应参考，返回去回声后的麦克风（与输入等长）。 */
    process(mic, ref) {
      const n = mic.length;
      const out = new Float32Array(n);
      if (n === 0) return out;
      const bufLen = xBuf.length;
      for (let i = 0; i < n; i++) {
        xBuf[cursor] = ref && i < ref.length ? ref[i] : 0;
        cursor = (cursor + 1) % bufLen;
        if (filled < bufLen) filled += 1;
        const d = mic[i];
        if (filled >= delay + filterLength) {
          let y = 0;
          let norm = 0;
          let idx = (cursor - delay + bufLen) % bufLen;
          for (let t = 0; t < filterLength; t++) {
            const x = xBuf[idx];
            y += w[t] * x;
            norm += x * x;
            idx = (idx - 1 + bufLen) % bufLen;
          }
          const e = d - y;
          out[i] = Number.isFinite(e) ? e : 0;
          if (norm > MIN_REF_NORM && !frozen) {
            const gain = (mu * e) / (norm + eps);
            idx = (cursor - delay + bufLen) % bufLen;
            for (let t = 0; t < filterLength; t++) {
              w[t] += gain * xBuf[idx];
              idx = (idx - 1 + bufLen) % bufLen;
            }
          }
        } else {
          out[i] = d;
        }
      }
      return out;
    },
  };
}

const GATE_DEFAULTS = {
  /** 自动打断要求残差高出回声地板的分贝数（安静环境 6，外放误触发就调大） */
  echoGateDb: 6,
  /** 回声地板的自适应速度：越小越稳（每块保留的比例） */
  floorDecay: 0.98,
};

/**
 * 回声门控 / 双讲判定。
 *
 * 逻辑：只在「正在播报」期间工作。首块把当前能量当作回声地板，之后在**非双讲**的块上
 * 缓慢跟踪地板；当某块能量高出地板 `echoGateDb` 分贝时判定为双讲（= 用户在说话）。
 * 双讲期间冻结地板更新，否则用户的大嗓门会被当成新的「回声水平」而抬高门槛，
 * 导致越说越难打断。
 */
export function createEchoGate(options = {}) {
  const echoGateDb = options.echoGateDb ?? GATE_DEFAULTS.echoGateDb;
  const floorDecay = options.floorDecay ?? GATE_DEFAULTS.floorDecay;
  const gateRatio = Math.pow(10, echoGateDb / 20);
  let floor = 0;
  let peak = 0;
  let doubleTalk = false;

  return {
    get floor() {
      return floor;
    },
    get peak() {
      return peak;
    },
    get doubleTalk() {
      return doubleTalk;
    },
    /** 播报停止时复位（下次播报重新学习地板）。 */
    reset() {
      floor = 0;
      peak = 0;
      doubleTalk = false;
    },
    /**
     * @param {number} rms 当前块能量
     * @param {boolean} playing 是否正在播报
     * @param {number} weight 本块占的时间权重（用于自适应速度），默认 1
     */
    update(rms, playing, weight = 1) {
      if (!playing) {
        floor = 0;
        peak = 0;
        doubleTalk = false;
        return doubleTalk;
      }
      peak = Math.max(peak * Math.pow(0.9, weight), rms);
      doubleTalk = floor > 0 && rms > floor * gateRatio;
      if (floor === 0) {
        floor = rms;
      } else if (!doubleTalk) {
        const alpha = 1 - Math.pow(floorDecay, weight);
        floor = floor * (1 - alpha) + rms * alpha;
      }
      return doubleTalk;
    },
  };
}

/**
 * 断句：把流式识别出来的文本切成「可以拿去合成朗读」的句子。
 *
 * 与打字不同，语音播报要尽早出声，所以遇到中文句读/换行就切；
 * 但没有句读的长句也不能一直等——超过 `maxChars` 就在最近的逗号/空格处切，
 * 再不行就硬切（否则长回答会「憋很久才开口」）。
 */
export function createSentenceChunker(options = {}) {
  const maxChars = options.maxChars ?? 60;
  const hardBreak = new Set(["。", "！", "？", "!", "?", "\n", "；", ";"]);
  const softBreak = new Set(["，", ",", "、", "：", ":", " "]);
  let buffer = "";

  const take = (text) => {
    buffer = buffer.slice(text.length);
    return text;
  };

  return {
    /** 追加增量，返回本次可以播报的句子数组（可能为空）。 */
    push(delta) {
      if (!delta) return [];
      buffer += delta;
      const out = [];
      for (;;) {
        const hit = firstBreakIndex(buffer, hardBreak);
        if (hit >= 0) {
          out.push(take(buffer.slice(0, hit + 1)).trim());
          continue;
        }
        if (buffer.length <= maxChars) break;
        const soft = lastBreakIndex(buffer.slice(0, maxChars), softBreak);
        const cut = soft >= 0 ? soft + 1 : maxChars;
        out.push(take(buffer.slice(0, cut)).trim());
      }
      return out.filter((s) => s.length > 0);
    },
    /** 回合结束时把残留吐出来。 */
    flush() {
      const rest = buffer.trim();
      buffer = "";
      return rest ? [rest] : [];
    },
    get pending() {
      return buffer;
    },
  };
}

function firstBreakIndex(text, set) {
  for (let i = 0; i < text.length; i++) if (set.has(text[i])) return i;
  return -1;
}

function lastBreakIndex(text, set) {
  for (let i = text.length - 1; i >= 0; i--) if (set.has(text[i])) return i;
  return -1;
}
