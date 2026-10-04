/**
 * 渲染层插件运行时 · 注册表（10-04 阶段 5）。
 *
 * 主进程有容器（`electron/context.ts`）+ 组合表（`composition.json`），渲染层此前**没有**
 * 对应物 —— 设置页虽已是"注册表式"（`settingsPagesOf(app)[page].render()`），但它是
 * **为设置页而写的一次性派发**，别的东西（浮层、右键菜单、标题栏按钮）没法挂。
 *
 * 这一层就是把那套已验证的注册表模式**泛化**成一个可复用的插槽机制：
 *   registerSlot / slotOf / slotsOf  —— 声明式注册，按 id 覆盖式登记
 *   Slot                          —— 渲染侧消费（空实现时不渲染任何东西 ⇒ 零行为变化）
 *
 * ⛔ **为什么不用 React Context 传插件**：Context 会让所有消费者在 provider 变化时重渲染，
 *    而插槽的语义是"**按 id 精确挂载**"。用模块级注册表 + 显式读取，粒度更细、
 *    也不会让既有设置页组件白白重渲。
 *
 * ⛔ 为什么不碰 `app-state`（17,600 行）：它是拆分成果不是欠账。插槽机制刻意设计成
 *    **零侵入** —— 不改既有设置页的 DOM/class，只在它们愿意挂的地方放一个 `<Slot>`。
 *    DOM 结构与 class 名是 `accept.mjs` 的 CDP 选择器依赖，改了会红（AGENTS.md 硬纪律第 2 条）。
 */

import type { ReactNode } from "react";
import { Slot } from "./Slot";

/**
 * 一个插槽的注册项。
 *
 * ⛔ `render` 收到的是**插槽自己的 props**，不是整个 app —— 插件要什么就声明什么，
 *    别把 `HarnessAppApi` 整个塞进去（那会让插件依赖它用不到的几十个字段，
 *    且 app 变化时无法做细粒度 memo）。
 */
export type SlotRegistration<P = Record<string, unknown>> = {
  /** 人类可读名（插件清单视图用） */
  label?: string;
  /** 插件 id（清单视图按它归类；缺省用注册时的 callerId） */
  pluginId?: string;
  /** 相对顺序，小的先渲染（同值按注册先后） */
  order?: number;
  /** 实际渲染 */
  render: (props: P) => ReactNode;
};

const REGISTRY = new Map<string, SlotRegistration<never>>();
const PLUGIN_IDS = new Map<string, string>();
/** 变更订阅（`useSyncExternalStore` 用）：注册/覆盖/卸载都通知。 */
const LISTENERS = new Set<() => void>();
/**
 * ⛔ 版本号是 `useSyncExternalStore` 的 getSnapshot：**必须返回稳定值**。
 *   返回 `REGISTRY.size` 会在"覆盖注册"时不变（size 相同）⇒ 订阅者不重渲染 ⇒ 覆盖不生效。
 *   用单调递增的版本号，任何变更都会让它变化。
 */
let VERSION = 0;
function notify(): void {
  VERSION += 1;
  for (const fn of [...LISTENERS]) {
    try { fn(); } catch { /* 单个订阅者出错不影响其余 */ }
  }
}
/** 订阅注册表变更（返回退订函数）。 */
export function subscribeSlots(fn: () => void): () => void {
  LISTENERS.add(fn);
  return () => { LISTENERS.delete(fn); };
}
/** 当前版本号（给 `useSyncExternalStore` 当 getSnapshot）。 */
export function slotVersion(): number {
  return VERSION;
}

/**
 * 注册一个插槽。
 *
 * @param id 插槽 id（如 `"settings.general.bottom"`）—— **建议带页面前缀**，
 *           否则不同插件很容易撞到同一个裸名字（`"footer"` 这种）。
 * @param reg 注册项；重复注册**覆盖**（后注册赢）——
 *           ⛔ 覆盖不报错是刻意的：开发期热更新会重复注册，硬报错会让整个应用挂掉；
 *           但覆盖会静默生效，所以【268】守卫盯着"同一 id 被不同 pluginId 注册"。
 * @param pluginId 调用方插件 id（写进清单视图，便于回答"这条是谁挂的"）。
 */
export function registerSlot<P extends Record<string, unknown> = Record<string, unknown>>(
  id: string,
  reg: SlotRegistration<P>,
  pluginId?: string
): () => void {
  if (!id || typeof id !== "string") throw new Error("[registerSlot] 插槽 id 必须是非空字符串");
  if (typeof reg?.render !== "function") throw new Error(`[registerSlot] ${id} 缺少 render 函数`);
  const prevOwner = PLUGIN_IDS.get(id);
  if (prevOwner && pluginId && prevOwner !== pluginId) {
    // 不抛错（见上），但留一条 console 线索 —— 静默覆盖在生产环境极难排查
    console.warn(`[slot] "${id}" 被 ${pluginId} 覆盖（原属 ${prevOwner}）`);
  }
  REGISTRY.set(id, reg as SlotRegistration<never>);
  if (pluginId) PLUGIN_IDS.set(id, pluginId);
  notify();   // 通知订阅者（覆盖注册也要通知：size 不变但内容变了）
  return () => {
    // 卸载：只有还属于自己时才摘（避免误删别人的覆盖）
    if (PLUGIN_IDS.get(id) === pluginId || !pluginId) {
      REGISTRY.delete(id);
      PLUGIN_IDS.delete(id);
      notify();
    }
  };
}

/** 取单个插槽（未注册 ⇒ null）。 */
export function slotOf<P extends Record<string, unknown> = Record<string, unknown>>(id: string): SlotRegistration<P> | null {
  return (REGISTRY.get(id) as SlotRegistration<P> | undefined) ?? null;
}

/**
 * 按前缀取一组插槽（已按 order、再按注册先后排序）。
 *
 * 例：`slotsOf("settings.general.")` 取所有挂在 general 页底部的扩展点。
 */
export function slotsOf<P extends Record<string, unknown> = Record<string, unknown>>(prefix: string): Array<[string, SlotRegistration<P>]> {
  const out: Array<[string, SlotRegistration<P>]> = [];
  for (const [id, reg] of REGISTRY) {
    if (id.startsWith(prefix)) out.push([id, reg as SlotRegistration<P>]);
  }
  out.sort((a, b) => (a[1].order ?? 100) - (b[1].order ?? 100));
  return out;
}

/** 全部注册项（插件清单视图用）：`[{ id, label, pluginId, order }]`。 */
export function listSlots(): Array<{ id: string; label: string; pluginId: string; order: number }> {
  return [...REGISTRY.entries()].map(([id, reg]) => ({
    id,
    label: reg.label ?? id,
    pluginId: reg.pluginId ?? PLUGIN_IDS.get(id) ?? "(未标注)",
    order: reg.order ?? 100,
  })).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** 注册总数（守卫【268】用；生产代码不该关心这个）。 */
export function slotCount(): number {
  return REGISTRY.size;
}

export { Slot };
