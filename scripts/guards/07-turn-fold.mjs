/**
 * 预检守卫组：07-turn-fold（入口，10-28 拆分）。
 *
 * 原 07-turn-fold.mjs 的 run() 单体 4854 行 —— 多路并行写者往同一文件加守卫会互相覆盖（09-22 已发生过）。
 * ⇒ 按**语句边界**切进 07-turn-fold/ 的 6 段，正文逐字未改、执行顺序不变。
 * ⛔ 拆段不减少断言：条数由 _ctx 的 EXPECTED_CHECKS 闸门卡死，少一条预检直接报红；本文件只按序 await。
 */
import { run as part_01_mjs } from "./07-turn-fold/part-01.mjs";
import { run as part_02_mjs } from "./07-turn-fold/part-02.mjs";
import { run as part_03_mjs } from "./07-turn-fold/part-03.mjs";
import { run as part_04_mjs } from "./07-turn-fold/part-04.mjs";
import { run as part_05_mjs } from "./07-turn-fold/part-05.mjs";
import { run as part_06_mjs } from "./07-turn-fold/part-06.mjs";

export async function run() {
  await part_01_mjs();
  await part_02_mjs();
  await part_03_mjs();
  await part_04_mjs();
  await part_05_mjs();
  await part_06_mjs();
}
