// 覆盖层焦点归还。
//
// 背景：设置页、删除确认框等遮罩层关闭后，浏览器把焦点丢给 body，主界面的输入框
// 随之失焦 —— 表现就是「删除完回到对话框，打字没反应，得再点一下输入框」。
// 这类问题散落在每一个弹窗上，逐个改关闭回调既容易漏也容易和新弹窗脱节，
// 所以这里用 DOM 事件统一兜住：任何遮罩内的元素失去焦点且焦点落空时，把焦点还给
// 打开遮罩前的那个元素（若它已被卸载，则还给主输入框）。
//
// 只在「焦点是从遮罩内元素丢失」时介入，不打扰用户主动点击空白区域的失焦意图。

export type FocusableLike = { focus?: (options?: { preventScroll?: boolean }) => void };

/**
 * 全屏遮罩容器。绝大多数用 `.modal-backdrop`，但历史命名留下几个独立容器
 * （信息弹窗 `.info-modal-mask`、命令面板 `.palette-backdrop`），漏掉它们会让弹窗内的
 * 元素被误记成归还目标。`closest()` 与 `querySelector()` 都支持逗号分隔多选。
 */
export const OVERLAY_SELECTOR = ".modal-backdrop, .info-modal-mask, .palette-backdrop";

export type FocusReturnEnv = {
  doc: {
    activeElement: unknown;
    body: unknown;
    querySelector: (selector: string) => unknown;
    contains: (node: any) => boolean;
    addEventListener: (type: string, listener: (event: any) => void, capture?: boolean) => void;
    removeEventListener: (type: string, listener: (event: any) => void, capture?: boolean) => void;
  };
  schedule: (callback: () => void) => void;
  getFallback: () => FocusableLike | null;
  /** 可选：提供 window 时一并包装原生 confirm/alert（它们不产生 focusout）。 */
  win?: Record<string, unknown>;
};

function canFocus(value: unknown, body: unknown): value is FocusableLike {
  return !!value && value !== body && typeof (value as FocusableLike).focus === "function";
}

export function installFocusReturn(env: FocusReturnEnv): () => void {
  const { doc, schedule, getFallback, win } = env;
  let saved: FocusableLike | null = null;
  // 焦点最近一次是否落在遮罩内。必须在 focusin 时判定：等遮罩关闭再回头 closest()
  // 已经查不到了 —— 那时节点早已从文档里移除。
  let focusWasInOverlay = false;

  const inOverlay = (node: unknown) => {
    const target = node as { closest?: (selector: string) => unknown } | null;
    return Boolean(target && typeof target.closest === "function" && target.closest(OVERLAY_SELECTOR));
  };

  const capture = () => {
    if (canFocus(doc.activeElement, doc.body)) saved = doc.activeElement as FocusableLike;
  };

  const restore = () =>
    schedule(() => {
      if (canFocus(doc.activeElement, doc.body)) return; // 已有明确焦点，不抢
      if (doc.querySelector(OVERLAY_SELECTOR)) return; // 还有遮罩打开中
      const target = saved && doc.contains(saved) ? saved : getFallback();
      if (!target || typeof target.focus !== "function") return;
      target.focus({ preventScroll: true });
    });

  const onFocusIn = (event: any) => {
    const target = event?.target;
    if (!target || !canFocus(target, doc.body)) {
      return;
    }
    if (inOverlay(target)) {
      // 遮罩内的元素不作为归还目标（它马上就要被卸载了）
      focusWasInOverlay = true;
      return;
    }
    focusWasInOverlay = false;
    saved = target as FocusableLike;
  };

  const onFocusOut = (event: any) => {
    if (event?.relatedTarget) return; // 焦点有明确去处，正常切换
    const from = event?.target;
    // 遮罩卸载后节点已脱离文档，closest() 查不到遮罩，靠 focusin 阶段记下的状态判断；
    // 另一种情况是该元素自身被移除（例如删掉某条消息），焦点同样会落空，一并兜住。
    const detached = !!from && !doc.contains(from);
    if (!focusWasInOverlay && !detached) return;
    focusWasInOverlay = false;
    restore();
  };

  doc.addEventListener("focusin", onFocusIn, true);
  doc.addEventListener("focusout", onFocusOut, true);

  // 原生 confirm/alert 由系统对话框接管焦点，关闭后不产生 focusout，
  // 常见结果是焦点直接落到 body，只能主动归还。
  const restoreNative: Array<() => void> = [];
  if (win) {
    for (const key of ["confirm", "alert"]) {
      const native = win[key];
      if (typeof native !== "function") continue;
      const original = native as (message?: unknown) => unknown;
      const wrapped = (message?: unknown) => {
        capture();
        try {
          return original.call(win, message);
        } finally {
          restore();
        }
      };
      win[key] = wrapped;
      restoreNative.push(() => {
        win[key] = original;
      });
    }
  }

  return () => {
    doc.removeEventListener("focusin", onFocusIn, true);
    doc.removeEventListener("focusout", onFocusOut, true);
    for (const revert of restoreNative) revert();
  };
}
