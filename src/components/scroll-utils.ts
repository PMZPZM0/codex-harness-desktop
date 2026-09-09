/**
 * 滚动容器内的内容坐标计算。
 *
 * 背景：`.turn-group` 是 position:relative，所以元素自带的 `offsetTop` 是相对回合组的
 * （通常接近 0），直接拿它当 scrollTop 会把视图甩到会话最顶部 —— 这正是「发送后置顶
 * 我的消息」一直不生效的根因。这里用两次 rect 求差，结果与任何中间定位祖先无关。
 *
 * 用法（替换 scrollToLatestUser 里的 target.offsetTop）：
 *   const top = contentOffsetTop(target, el);
 *   el.scrollTo({ top: Math.max(0, top - 12), behavior: "auto" });
 */
export function contentOffsetTop(el: HTMLElement, scroller: HTMLElement) {
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
}

/**
 * 瞬时定位到滚动容器底部（最新消息）。
 *
 * 背景 1：`.timeline` 上设置了 `scroll-behavior: smooth`，Chrome 里 `scrollTo({behavior:"auto"})`
 * 和直接赋值 `scrollTop` 都会走平滑动画——切换会话时表现为"从上往下滚动"，且动画目标
 * 基于发起瞬间的 scrollHeight，后续 markdown/图片渲染增高后会停在半路（"进去不是最新
 * 消息位置"）。这里临时把 scrollBehavior 置为 auto 再赋值，保证瞬时到位、无动画。
 *
 * 背景 2：切到长会话时 cached/sync 渲染是首帧，但代码块高亮、图片懒加载、markdown 折
 * 叠等都在首次绘制后才陆续完成，scrollHeight 持续上涨。若只跳一次，跳完时的高度只是
 * "瞬时"快照，后续增高会让原 scrollTop 偏离最新尾部——视觉上"切过去就在中段"。
 * 修法：连续 rAF 直到 scrollHeight 连续两帧不再变化（视为内容渲染稳定）才回调
 * onSettled；上限 60 帧 (~1s) 防无限循环。
 *
 * @param scroller 滚动容器（可为 null 时直接回调，便于上层一视同仁处理）
 * @param onSettled scrollHeight 稳定后回调；多次调用时上层应自行去重/重置
 */
export function jumpToBottom(
  scroller: HTMLElement | null,
  onSettled?: () => void,
) {
  if (!scroller) {
    onSettled?.();
    return;
  }
  scroller.style.scrollBehavior = "auto";
  let lastHeight = -1;
  let stableFrames = 0;
  let totalFrames = 0;
  const MAX_FRAMES = 60; // ~1s 上限（60 * 16ms），超过即强制 settled
  const tick = () => {
    totalFrames += 1;
    scroller.scrollTop = scroller.scrollHeight;
    if (scroller.scrollHeight === lastHeight) {
      stableFrames += 1;
    } else {
      // 高度还在涨：重置稳定计数，但继续追
      stableFrames = 0;
      lastHeight = scroller.scrollHeight;
    }
    // 连续两帧没变化视为渲染稳定；超上限也强制收尾
    if (stableFrames >= 2 || totalFrames >= MAX_FRAMES) {
      scroller.style.scrollBehavior = "";
      onSettled?.();
      return;
    }
    requestAnimationFrame(tick);
  };
  tick();
}