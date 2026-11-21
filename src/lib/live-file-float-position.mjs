/**
 * 实时文件浮窗的落位（纯函数，供组件与守卫共用）。
 *
 * 用户 11-21 实测：「经常遮住输入框」。旧实现只避视口边缘，而实时编辑行就在输入框上方，
 * 「下方还有空间」时浮窗直接压到输入框上。这里把输入框当**禁区**：
 *   · 编辑行在输入框上方 ⇒ 浮窗底边不得越过输入框顶边；
 *   · 编辑行在输入框下方 ⇒ 浮窗顶边不得越过输入框底边；
 *   · 两条边都放不下 ⇒ 在禁区外可用高度里钳制，并把 maxHeight 收窄（不靠裁切盖住输入框）。
 *
 * @param {{ vw:number; vh:number; height:number; anchor?:{top:number;bottom:number}|null; composer?:{top:number;bottom:number;left:number;width:number}|null }} input
 * @returns {{ left:number; width:number; top:number; maxHeight:number }}
 */
export function placeLiveFileFloat({ vw, vh, height, anchor = null, composer = null }) {
  const M = 8, GAP = 8;
  const width = Math.max(240, Math.min(composer ? composer.width : 820, vw - M * 2));
  const left = Math.max(M, Math.min(composer ? composer.left : (vw - width) / 2, vw - width - M));
  const compTop = composer ? composer.top : vh - M;
  const compBottom = composer ? composer.bottom : vh - M;
  const anchorTop = anchor ? anchor.top : compTop - GAP;
  const anchorBottom = anchor ? anchor.bottom : compTop - GAP;
  const aboveRegion = { minTop: M, maxBottom: Math.min(vh - M, compTop - GAP) };
  const belowRegion = { minTop: Math.max(M, compBottom + GAP), maxBottom: vh - M };
  const anchorAbove = anchorBottom <= compTop;
  const anchorBelow = anchorTop >= compBottom;
  let region = anchorBelow ? belowRegion : aboveRegion;
  const other = region === aboveRegion ? belowRegion : aboveRegion;
  /* 首选一侧放不下一个可用浮窗（<140）时换到另一侧；两侧都小才退回首选侧并收窄。 */
  if (region.maxBottom - region.minTop < 140 && other.maxBottom - other.minTop > region.maxBottom - region.minTop) {
    region = other;
  }
  if (!anchorAbove && !anchorBelow) region = aboveRegion;
  const minTop = region.minTop;
  const maxBottom = region.maxBottom;
  const available = Math.max(140, maxBottom - minTop);
  const maxHeight = Math.min(available, Math.max(180, Math.round(vh * 0.46) + 44));
  const fit = Math.min(Math.max(0, height), maxHeight);
  const below = anchorBottom + 6;
  const above = anchorTop - 6 - fit;
  let top;
  if (below + fit <= maxBottom) top = below;
  else if (above >= minTop) top = above;
  else top = minTop;
  top = Math.max(minTop, Math.min(top, maxBottom - fit));
  return { left: Math.round(left), width: Math.round(width), top: Math.round(top), maxHeight: Math.round(maxHeight) };
}
