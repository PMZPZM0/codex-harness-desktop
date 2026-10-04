/**
 * 渲染层插槽的**自检出口**（10-04 补齐扩展面时建）。
 *
 * 存在的理由：`topbar.end` / `overlay.root` 两个插槽的注册方本来是"未来的插件"。
 * 如果那两个插槽只留 `<Slot id=… />` 而没有 loader，它们就是**永远为空的占位** ——
 * 看起来是扩展点，实际上没有任何东西能挂上去（和"装饰性开关"是同一类假功能）。
 *
 * ⛔ 所以这里放一个**真实但极简**的注册方：
 *   · 它注册自己（证明链路通）
 *   · 默认什么都不渲染（`return null`）—— 不给用户添任何可见内容
 *   · 提供一个可编程的探针（`__slotProbe`），供 e2e / 调试确认插槽链路是否活着
 *
 * ⚠️ 它**不是**示例插件（那种东西会被人照抄进生产）。它只证明三件事：
 *   ① 懒加载 loader 路径正确（模块能被动态 import 到）
 *   ② `registerSlot` 在模块体执行时能生效
 *   ③ `useSyncExternalStore` 的刷新链路通（注册后消费者真的会重渲染）
 */
import { useEffect } from "react";
import { registerSlot } from "./registry";

/** 插槽链路的运行时探针（供 CDP / e2e 求值，确认插槽真挂上了）。 */
declare global {
  interface Window {
    __slotProbe?: { loaded: boolean; registered: string[] };
  }
}

if (typeof window !== "undefined") {
  window.__slotProbe = window.__slotProbe ?? { loaded: true, registered: [] };
}

const registered: string[] = [];
for (const id of ["topbar.end", "overlay.root"]) {
  registerSlot(id, {
    label: `自检出口 · ${id}`,
    pluginId: "harness-selfcheck",
    order: 9999,   // 排最后：真实插件的按钮永远在它前面
    render: () => null,   // ⛔ 默认不渲染任何东西
  }, "harness-selfcheck");
  registered.push(id);
  if (typeof window !== "undefined") window.__slotProbe?.registered.push(id);
}

/** 探针组件（当前未被任何插槽使用；留给将来的调试面板）。 */
export function SlotProbe() {
  useEffect(() => {
    if (typeof window !== "undefined" && window.__slotProbe) {
      window.__slotProbe.loaded = true;
    }
  }, []);
  return null;
}
