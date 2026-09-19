/** 刻度尺悬停滚轮的滑动音（合成棘轮咔哒，见 wheel-tick.mjs 顶部选型注释）。
 *  @param direction 滚动方向：-1 = 上滑（音调略高），1 = 下滑（音调略低）
 *  @returns 是否真的播了声（节流窗口内/环境不支持时返回 false，调用方无需处理） */
export function playWheelTick(direction: number): boolean;
