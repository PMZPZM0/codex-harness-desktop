/**
 * 渲染层插件运行时 · 插槽消费侧（10-04 阶段 5）。
 *
 * 用法（一行，零侵入）：
 *   import { Slot } from "../../../../../runtime/registry";
 *   <Slot id="settings.general.bottom" props={{ app }} />
 *
 * ⛔ **未注册 ⇒ 渲染 null**（不报错、不占位）：这是"插槽零行为变化"的关键 ——
 *    宿主没挂任何东西时，Slot 在 DOM 里什么都不产生，既有布局与选择器完全不受影响。
 *
 * ⛔ 为什么不直接 `slotsOf(id).map(...)` 让调用方自己渲染：那样每个挂载点都要写排序与
 *    空值处理，N 处重复且容易漏。`Slot` 是唯一的消费入口。
 *
 * ⛔ props 默认 `{}` 而非必填：插槽的 props 由**注册方**定义，宿主不该知道要传什么。
 *    传了但注册方用不到 ⇒ 无害；没传而注册方要用 ⇒ 它的 bug（类型上体现为注册方的 P）。
 */
import type { ReactNode } from "react";
import { slotOf, slotsOf, type SlotRegistration } from "./registry";

/** 渲染单个插槽（id 精确匹配）。 */
export function Slot<P extends Record<string, unknown> = Record<string, unknown>>({ id, props }: { id: string; props?: P }): ReactNode {
  const reg = slotOf<P>(id);
  if (!reg) return null;
  return <>{reg.render((props ?? {}) as P)}</>;
}

/**
 * 渲染一组插槽（前缀匹配，已排序）。
 *
 * ⛔ key 用插槽 id 而不是索引：列表会随注册/卸载变化，用索引会让 React 复用错节点
 *    （表现是"A 插件卸载后 B 插件的局部 state 串了"）—— 极难归因。
 */
export function SlotGroup<P extends Record<string, unknown> = Record<string, unknown>>({ prefix, props }: { prefix: string; props?: P }): ReactNode {
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
