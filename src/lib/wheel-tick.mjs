// 刻度尺的「棘轮咔哒」音（09-19 用户要求；10-26 用户：「触发有延迟，有时候触发不出来」）。
//
// 选型：WebAudio 合成 —— 无音频资产、零依赖、确定性；上滑音调略高、下滑略低，
//   短促衰减（14ms），音量刻意压低（0.07）只做触觉式提示。
//
// ⛔⛔ 10-26 三处导致「延迟 / 没声音」的坑（都在这一个文件里，别改回去）：
//   ① **AudioContext 懒创建**：第一次调用才 new，而 Chromium 在用户手势之前创建的是
//      `suspended` 上下文，`resume()` 是**异步**的 ⇒ 那一声要么丢、要么延后到恢复才响
//      （听感就是"第一下有延迟/没声音"）。⇒ 改成**预解锁**：模块加载时挂一次性的
//      pointerdown/keydown 捕获监听，第一次交互就把 ctx 建好并 resume。
//   ② **共享节流窗口**：悬停、刻度尺自身滚轮、消息滚动三条路径共用一个 `lastAt`，
//      互相把对方的声音吞掉（"有时候触发不出来"）。⇒ 按 channel 分开计时。
//   ③ 上下文还没 running 时**不要排延迟音**：直接跳过这一声（返回 false）。
//      排进去只会在恢复后突然响一下，比不响更奇怪。
//
// 纪律：任何异常（不支持 / 被策略拦）一律静默降级返回 false —— 声音是锦上添花，
//   绝不能把滚动交互搞挂。

let ctx = null;
let primed = false;
/** 按通道分开的节流窗口（⛔ 别再合并成一个 lastAt） */
const lastAtByChannel = new Map();
/** 上滑（看更早的消息）音调略高，下滑略低 —— 方向可辨但不吵 */
const UP_FREQ = 2300;
const DOWN_FREQ = 1700;
const DURATION_SEC = 0.014;
const PEAK_GAIN = 0.07;

/** 预解锁监听（capture + passive：只观察，不拦任何交互）。⛔ 增删必须用同一份，否则摘不掉。 */
const UNLOCK_EVENTS = [
  ["pointerdown", { capture: true }],
  ["keydown", { capture: true }],
  ["wheel", { capture: true, passive: true }],
];

function ensureCtx() {
  const AC = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
  if (!AC) return null;
  if (!ctx) {
    try {
      ctx = new AC({ latencyHint: "interactive" });
    } catch {
      ctx = new AC();
    }
  }
  return ctx;
}

/** 预解锁：建上下文 + resume（幂等）。没有用户手势时 resume 会挂着，等手势后自然生效。 */
export function primeWheelTick() {
  const c = ensureCtx();
  if (!c) return false;
  if (c.state === "suspended") void c.resume().catch(() => undefined);
  primed = true;
  return c.state === "running";
}

/** 音频上下文当前状态（验收/排查用：none / suspended / running）。 */
export function wheelTickState() {
  return ctx ? String(ctx.state) : "none";
}

/* 一次性预解锁：用户第一次点 / 按键 / 滚轮就把上下文备好（capture + 不 preventDefault，不拦交互）。
   ⛔ 把 wheel 也算进来：很多人是"直接滚一下"而不是先点击 ⇒ 不监听它的话第一下必定没声音。 */
if (typeof window !== "undefined") {
  const unlock = () => {
    primeWheelTick();
    if (ctx && ctx.state === "running") {
      try {
        for (const [type, opts] of UNLOCK_EVENTS) window.removeEventListener(type, unlock, opts);
      } catch { /* 忽略 */ }
    }
  };
  try {
    for (const [type, opts] of UNLOCK_EVENTS) window.addEventListener(type, unlock, opts);
  } catch { /* 极端环境下没有 window 事件系统 */ }
  /* 启动就先建一个（此时多半是 suspended，但省掉"第一次交互时再建"的那一下开销） */
  primeWheelTick();
}

/**
 * 播一声咔哒。
 * @param direction <0 上滑（音调高）/ >0 下滑（音调低）
 * @param rawOptions.channel 节流通道（默认 default）—— 悬停 / 滚动 / 刻度尺滚轮各用各的，
 *                           ⛔ 共用会把彼此的声音吞掉
 * @param rawOptions.minGapMs 该通道的最小间隔（默认 30）
 * @returns 是否真的排了音
 */
export function playWheelTick(direction, rawOptions) {
  try {
    const options = rawOptions ?? {};
    const channel = String(options.channel ?? "default");
    const minGap = Number(options.minGapMs ?? 30);
    const c = ensureCtx();
    if (!c) return false;
    /* ⛔ ③：没 running 就不排音（先 resume，这一声直接放弃） */
    if (c.state !== "running") {
      if (c.state === "suspended") void c.resume().catch(() => undefined);
      primed = true;
      return false;
    }
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const last = lastAtByChannel.get(channel) ?? 0;
    if (now - last < minGap) return false;
    lastAtByChannel.set(channel, now);
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "square";
    osc.frequency.value = Number(direction) < 0 ? UP_FREQ : DOWN_FREQ;
    gain.gain.setValueAtTime(PEAK_GAIN, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + DURATION_SEC);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + DURATION_SEC + 0.002);
    return true;
  } catch {
    return false;
  }
}
