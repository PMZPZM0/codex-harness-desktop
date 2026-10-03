/* ⛔ 本文件由 scripts/gen-domain-registry.mjs 生成，禁手改。
   改"启用哪些域"请改 electron/composition.json，然后跑：npm run gen:domains
   守卫【253】逐字节比对生成物与 renderRegistry() 的产物 —— 手改过、或改了配置没重跑，都会红。 */
export type EnabledDomain = { id: string; config: unknown };

/** 已启用的域（顺序 = composition.json 里的顺序 = 挂载顺序）。
 *  ⛔⛔ 这里**只放数据，绝不 import 域模块** —— 生成物会被**域自己** import（域要查"我启用了没"），
 *     一旦这里也 import 域就成**循环依赖**：CJS 下域模块还没求值完，plugin 值就是 undefined，
 *     启动即崩（10-03 实测事故：Cannot read properties of undefined (reading name) @ mountFeature）。
 *     ⛔⛔ 本函数体是**模板字符串**：里面**绝不能出现反引号**（会把模板提前闭合，生成器直接语法错误）。
 *     插件值由**域自己**传给 mountFromComposition(id, plugin)，环就此断开。 */
export const ENABLED: EnabledDomain[] = [
  { id: "queue-timer", config: null },
];
