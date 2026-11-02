/**
 * 应用级减动效策略（唯一口径，11-02 立）。
 *
 * 默认 `data-motion="force"`（`index.html` 首帧写入）= **无视系统「减少动态效果」**：
 * mac 用户实测这个系统开关会把全站动画冻住（09-16 事故），所以应用统一强制开启动效。
 *
 * ⛔ 任何「要不要动」的判断（CSS 静音块 / 3D 星空 canvas / 开机动画 / 鼠标视差）都必须走
 *    这里或同一条规则。直接读 `prefers-reduced-motion` 会出现「其它都在动，只有这一块
 *    冻住 / 不播」—— 11-02 用户在 mac 上连报两次（3D 星空、开机动画）。
 * ⛔ 属性缺失按默认 force 处理：首帧 effect 可能早于写 `data-motion` 的那条 effect。
 */

export const MOTION_FORCE = "force";

/** 策略是否强制开启动效（默认 / 缺失 = 强制）。 */
export function isMotionForced(flag) {
  return !flag || flag === MOTION_FORCE;
}

/** 是否该减弱动效：只有显式切成「跟随系统」（非 force）时才看系统偏好。 */
export function shouldReduceMotion(flag, systemReduced) {
  return !isMotionForced(flag) && Boolean(systemReduced);
}

/** 从当前文档读：`<html data-motion>` + 系统 `prefers-reduced-motion`。 */
export function readMotionReduced(doc) {
  const root = doc && doc.documentElement;
  if (!root) return false;
  const flag = root.dataset ? root.dataset.motion : root.getAttribute("data-motion");
  const system = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return shouldReduceMotion(flag, system);
}
