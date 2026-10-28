/**
 * 预检守卫组：06-app-behavior（入口，10-28 拆分）。
 *
 * 原 06-app-behavior.mjs 的 run() 单体 3867 行 —— 多路并行写者往同一文件加守卫会互相覆盖（09-22 已发生过）。
 * ⇒ 按**语句边界**切进 06-app-behavior/ 的 5 段，正文逐字未改、执行顺序不变。
 * ⛔ 拆段不减少断言：条数由 _ctx 的 EXPECTED_CHECKS 闸门卡死，少一条预检直接报红；本文件只按序 await。
 */
import { run as part_01_mjs } from "./06-app-behavior/part-01.mjs";
import { run as part_02_mjs } from "./06-app-behavior/part-02.mjs";
import { run as part_03_mjs } from "./06-app-behavior/part-03.mjs";
import { run as part_04_mjs } from "./06-app-behavior/part-04.mjs";
import { run as part_05_mjs } from "./06-app-behavior/part-05.mjs";

export async function run() {
  await part_01_mjs();
  await part_02_mjs();
  await part_03_mjs();
  await part_04_mjs();
  await part_05_mjs();
}
