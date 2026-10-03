/**
 * 组合运行时（P1，2026-10-03）：把"这个域该不该挂载"从域自己手里收回到组合配置。
 *
 * 用法（域文件底部一行，替代原先的 `mountFeature(feature)`）：
 * ```ts
 * mountFromComposition("queue-timer");
 * ```
 * ⛔ 为什么还要传一次 id：生成表是按 id 索引的，域自报 id 才能查到自己的行；
 *    id 写错（或没登记）**静默不挂载**是最难查的一类故障，所以这里返回布尔值，
 *    且守卫【253】要求"域文件里自报的 id 必须在 composition.json 里登记"。
 *
 * ⛔ 本文件属基座层（electron/ 根）：只依赖 context，不 import 任何域（域→基座单向）。
 */
import { mountFeature, type Plugin } from "./context";
import { ENABLED } from "./composition.gen";

/**
 * 挂载组合表里启用且登记过的那个域。
 * ⛔ 插件值由**调用方（域自己）**传进来：生成物只存数据（id/config），不 import 域 ——
 *    否则"生成物 import 域 + 域 import 生成物"成环，CJS 下 plugin 会是 undefined，启动即崩
 *    （10-03 事故）。传错/未导出时这里显式报错，不再让 `undefined.name` 把宿主带走。
 */
export function mountFromComposition<T>(id: string, plugin: Plugin<T>): boolean {
  if (!plugin) {
    throw new Error(`[composition] ${id}: 传入的插件是 undefined（循环依赖、或 export 名字写错）`);
  }
  const row = ENABLED.find((r) => r.id === id);
  if (!row) return false;
  mountFeature(plugin, row.config as never);
  return true;
}
