/**
 * 预检（聚合入口，~20 行）：按域顺序跑 guards/ 下的守卫组，然后汇总退出。
 *
 * 09-22 结构：原单文件 8,997 行 → guards/_ctx.mjs（共享上下文 + 汇总）+ guards/NN-*.mjs（按域分组）
 *   + 本文件。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生过一次）。
 * ⛔ 加新守卫请改 guards/ 下对应域的文件；新建组时在本文件 MODULES 登记。
 */
import { finish } from "./guards/_ctx.mjs";

const MODULES = [
  "01-build-ipc-css",
  "02-session-logic",
  "03-runtime-boot",
  "04-misc-and-tools",
  "05-ipc-contract",
  "06-app-behavior",
  "07-turn-fold",
  "08-app-regression",
  "09-structural",
  "10-memory-audit",
];

for (const name of MODULES) {
  const mod = await import(`./guards/${name}.mjs`);
  await mod.run();
}

finish();
