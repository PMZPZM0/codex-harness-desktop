/**
 * 控件皮肤 · 绑定订阅 hook（基座侧；基座组件经它读绑定，不反向 import 域层）。
 */
import { useEffect, useState } from "react";
import { getBinding, subscribe } from "../lib/ui-skin/store";

/** 订阅某原型的当前绑定（elementId 或 null=默认样式）。绑定变化即重渲染。 */
export function useSkinBinding(slotId: string): string | null {
  const [bound, setBound] = useState<string | null>(() => getBinding(slotId));
  useEffect(() => {
    setBound(getBinding(slotId));
    return subscribe(() => setBound(getBinding(slotId)));
  }, [slotId]);
  return bound;
}
