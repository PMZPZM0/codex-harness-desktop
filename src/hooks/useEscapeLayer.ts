import { useEffect, useRef } from "react";
import { pushEscapeLayer } from "../lib/escape-layer.mjs";

type EscapeHandler = (event: KeyboardEvent) => boolean | void;

/** 把「Esc 关闭本层」注册到全局 ESC 栈（只让最上层消费）。
 *  ⛔ 不要再用 window/document 的 keydown 监听关弹窗 —— 那样所有打开的层会被一次 Esc 一起关掉。
 *  handler 返回 false 表示本层不消费（交给下一层）。 */
export function useEscapeLayer(active: boolean, handler: EscapeHandler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    return pushEscapeLayer((event) => ref.current(event));
  }, [active]);
}
