/**
 * 手机看屏的「租约」（11-06 P1）：只读画面的生命周期与空闲保护。
 *
 * 为什么必须租约：手机可能被切后台、断网、直接锁屏 —— 若只在「用户点停止」时结束，
 * 桌面会一直处在被采集状态（这就是后门）。所以：
 *   · 手机每取一帧就 `touch()` 续租；超过 ttl（默认 15s）没有取帧 ⇒ `expired()` 为真，
 *     由采集侧自动停掉并通知桌面；
 *   · `start/stop` 幂等；`touch()` 在未开始时返回 false（防止一个迟到的取帧请求把租约"复活"）。
 *
 * 纯函数 + 注入时钟：守卫可以真跑「过期/续租/停止」三条时序，不必等真机 15 秒。
 */
export type ScreenLeaseState = { active: boolean; startedAt: number; lastTouch: number };

/** 屏幕共享租约：带 TTL，重复开始只刷新起点不叠加，超时自动失效。 */
export function createScreenLease(ttlMs = 15_000, now: () => number = () => Date.now()) {
  let active = false;
  let startedAt = 0;
  let lastTouch = 0;
  return {
    /** 开始（重复调用只刷新起点，不叠加） */
    start(): ScreenLeaseState {
      const at = now();
      active = true;
      startedAt = at;
      lastTouch = at;
      return { active, startedAt, lastTouch };
    },
    /** 取帧续租；未开始时返回 false（迟到的请求不能复活租约） */
    touch(): boolean {
      if (!active) return false;
      lastTouch = now();
      return true;
    },
    stop(): ScreenLeaseState {
      active = false;
      return { active, startedAt, lastTouch };
    },
    expired(): boolean {
      return active && now() - lastTouch > ttlMs;
    },
    state(): ScreenLeaseState {
      return { active, startedAt, lastTouch };
    },
    ttlMs,
  };
}
