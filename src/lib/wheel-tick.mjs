// 刻度尺悬停滚轮的滑动音（09-19 用户：「加一个声音反馈，选最贴合的」）。
// 选型：WebAudio 合成的「滚轮棘轮咔哒」——无音频资产、零依赖、确定性；
//   上滑（deltaY<0）音调略高、下滑略低，短促衰减（14ms），音量刻意压低（0.07）只做触觉式提示。
// 纪律：⚠️ 任何异常（AudioContext 被策略挂起/不支持）一律静默降级返回 false——
//   声音是锦上添花，绝不能把滚轮交互搞挂；节流 30ms 防快速连滚时叠成噪音。
let ctx = null;
let lastAt = 0;
const THROTTLE_MS = 30;
/** 上滑（看更早的消息）音调略高，下滑略低——方向可辨但不吵 */
const UP_FREQ = 2300;
const DOWN_FREQ = 1700;
const DURATION_SEC = 0.014;
const PEAK_GAIN = 0.07;

export function playWheelTick(direction) {
  try {
    const AC = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
    if (!AC) return false;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - lastAt < THROTTLE_MS) return false;
    lastAt = now;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = direction < 0 ? UP_FREQ : DOWN_FREQ;
    gain.gain.setValueAtTime(PEAK_GAIN, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + DURATION_SEC);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + DURATION_SEC + 0.002);
    return true;
  } catch {
    return false;
  }
}
