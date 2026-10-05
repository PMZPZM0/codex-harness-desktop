/**
 * Node ESM 解析钩子：把**无扩展名的相对导入**补成 `.ts`。
 *
 * ⛔ 为什么需要：预检里要**真跑**渲染层的 TS 模块（办公室模拟层 `office-sim.ts`），
 *   而它 import 的是 `./office-format`（无扩展名 —— 这是仓库约定，vite/tsc 都认）。
 *   `node --experimental-strip-types` 只负责**剥类型**，不做扩展名补全
 *   ⇒ 直接 import 会 `ERR_MODULE_NOT_FOUND`。
 * ⛔ 判据强度：不补这一个钩子，守卫就只能退化成 grep 源码（="代码写了"≠"跑起来对"）。
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      try { return await next(`${specifier}.ts`, context); } catch { /* 落到下面原样抛 */ }
    }
    throw error;
  }
}
