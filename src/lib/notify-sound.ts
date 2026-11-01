/**
 * 通知提示音（11-01 用户：「现在通知是系统默认的声音不好听，加一个音效」）。
 *
 * 为什么在**渲染层**合成、不放音频文件：
 *   · 主进程侧没有音频 API（Node 没有 Web Audio）⇒ 主进程只能让系统响它的默认音；
 *   · 塞一个 wav/mp3 进包 = 每个仓多一份素材 + 三仓同步面 + 授权/体积问题；
 *   · WebAudio 振荡器几行代码就能做出干净的「叮—咚」，音色/时长/音量全参数化，可随时调。
 *
 * 判据：**只在主进程通知真的发出去之后**播（见调用点），通知没弹（系统不支持/被静音策略拦）就不该响。
 *
 * ⛔ 单例 AudioContext：每次通知 new 一个会快速累积（浏览器上限约 6 个后直接静默失败）。
 * ⛔ 必须吞掉所有异常：没有音频设备 / 自动播放策略拦截 / 上下文被系统关掉 都不许影响主流程。
 */

type NotifyKind = "done" | "error";

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (ctx && ctx.state !== "closed") return ctx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    ctx = Ctor ? new Ctor() : null;
  } catch {
    ctx = null;
  }
  return ctx;
}

/** 一个柔和的音符：正弦基音 + 一点二次泛音，快起、指数衰减（听感接近「叮」）。 */
function tone(ac: AudioContext, freq: number, at: number, dur: number, peak: number) {
  const gain = ac.createGain();
  gain.connect(ac.destination);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);

  for (const [ratio, level] of [[1, 1], [2, 0.18]] as const) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * ratio, at);
    g.gain.value = level;
    osc.connect(g).connect(gain);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }
}

/**
 * 播通知提示音。
 *   · done  —— 上行五度（G5 → D6）：完成、正向；
 *   · error —— 下行（E5 → B4）：失败、收敛，不刺耳。
 */
export function playNotifyTone(kind: NotifyKind = "done"): void {
  try {
    const ac = audioContext();
    if (!ac) return;
    if (ac.state === "suspended") void ac.resume().catch(() => undefined);
    const t0 = ac.currentTime + 0.02;
    if (kind === "error") {
      tone(ac, 659.25, t0, 0.22, 0.16);
      tone(ac, 493.88, t0 + 0.13, 0.3, 0.14);
    } else {
      tone(ac, 783.99, t0, 0.2, 0.16);
      tone(ac, 1174.66, t0 + 0.1, 0.34, 0.15);
    }
  } catch {
    /* 提示音是锦上添花：任何失败都不许冒泡到通知链路 */
  }
}
