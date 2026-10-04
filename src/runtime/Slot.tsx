/**
 * 渲染层插件运行时 · 插槽消费侧（10-04 阶段 5）。
 *
 * 用法（零侵入，两种）：
 *   1) 注册方已被别处 import：
 *        <Slot id="settings.general.bottom" props={{ app }} />
 *   2) 注册方还没被加载（**推荐**，注册方不进初始 chunk）：
 *        <Slot id="settings.devtools.bottom" props={{ onNotice }}
 *              loader={() => import("../settings-devtools/DomainsPanel")} />
 *
 * ⛔ **未注册 ⇒ 渲染 null**（不报错、不占位）：这是"插槽零行为变化"的关键 ——
 *    宿主没挂任何东西时，Slot 在 DOM 里什么都不产生，既有布局与选择器完全不受影响。
 *
 * ⛔ 为什么不直接 `slotsOf(id).map(...)` 让调用方自己渲染：那样每个挂载点都要写排序与
 *    空值处理，N 处重复且容易漏。`Slot` 是唯一的消费入口。
 *
 * ⛔ 刷新机制用 `useSyncExternalStore` 而不是 `useState + forceUpdate`：插槽注册表是
 *    **模块外部状态**，用 useState 得自己实现"通知所有订阅者"，漏一个就是"内容不出现"，
 *    而且这类 bug 只在 dev（HMR 重复注册）下偶发，极难归因。
 *    `useSyncExternalStore` 的契约（getSnapshot 必须返回稳定引用）由 React 兜底。
 */
import { useCallback, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { slotOf, slotVersion, slotsOf, subscribeSlots, type SlotRegistration } from "./registry";

/** 渲染单个插槽（id 精确匹配）。`loader` 用于懒加载注册方模块。 */
export function Slot<P extends Record<string, unknown> = Record<string, unknown>>({
  id,
  props,
  loader,
}: {
  id: string;
  props?: P;
  loader?: () => Promise<unknown>;
}): ReactNode {
  // 订阅注册表变化：注册 / 覆盖 / 卸载都会触发重渲染
  useSyncExternalStore(subscribeSlots, slotVersion, slotVersion);

  const reg = slotOf<P>(id);
  // 未注册且给了 loader ⇒ 加载注册方（它的模块体里会调 registerSlot），加载完重渲染
  if (loader && !reg) {
    void loader();
    return null;
  }
  if (!reg) return null;
  return <>{reg.render((props ?? {}) as P)}</>;
}

/**
 * 渲染一组插槽（前缀匹配，已排序）。
 *
 * ⛔ key 用插槽 id 而不是索引：列表会随注册/卸载变化，用索引会让 React 复用错节点
 *    （表现是"A 插件卸载后 B 插件的局部 state 串了"）—— 极难归因。
 */
export function SlotGroup<P extends Record<string, unknown> = Record<string, unknown>>({
  prefix,
  props,
}: {
  prefix: string;
  props?: P;
}): ReactNode {
  useSyncExternalStore(subscribeSlots, slotVersion, slotVersion);
  const regs = slotsOf<P>(prefix);
  if (!regs.length) return null;
  return (
    <>
      {regs.map(([id, reg]) => (
        <SlotOf key={id} reg={reg} props={props} />
      ))}
    </>
  );
}

function SlotOf<P extends Record<string, unknown>>({ reg, props }: { reg: SlotRegistration<P>; props?: P }): ReactNode {
  return <>{reg.render((props ?? {}) as P)}</>;
}

export { useSlotRefresh };

/** 需要在插槽内容里也响应注册变化的场景用这个 hook（一般不需要，Slot 自己就订阅了）。 */
function useSlotRefresh(): number {
  const get = useCallback(() => slotOfCount(), []);
  return useSyncExternalStore(subscribeSlots, get, get);
}
function slotOfCount(): number {
  return slotVersion();
}
