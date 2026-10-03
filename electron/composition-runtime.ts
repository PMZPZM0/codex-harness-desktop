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
import { mountFeature, mountedFeatures } from "./context";
import { COMPOSITION } from "./composition.gen";

/** 挂载组合表里启用且登记过的那个域；未登记/已禁用返回 false（由调用方决定是否报错）。 */
export function mountFromComposition(id: string): boolean {
  const row = COMPOSITION.find((r) => r.id === id);
  if (!row) return false;
  mountFeature(row.plugin, row.config as never);
  return true;
}

/** 组合表里启用的域 id（守卫断言用）。 */
export function enabledDomainIds(): string[] {
  return COMPOSITION.map((r) => r.id);
}

/** 已挂载的域（= context 的挂载清单；两者不一致说明有人绕过组合表挂载）。 */
export function mountedDomainIds(): string[] {
  return mountedFeatures();
}
