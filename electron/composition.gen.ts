/* ⛔ 本文件由 scripts/gen-domain-registry.mjs 生成，禁手改。
   改"启用哪些域"请改 electron/composition.json，然后跑：npm run gen:domains
   守卫【253】逐字节比对生成物与 renderRegistry() 的产物 —— 手改过、或改了配置没重跑，都会红。 */
import type { Plugin } from "./context";
import { queueTimerFeature as feat_queue_timer } from "./features/queue-timer-ipc";

/** 已启用的域（顺序 = composition.json 里的顺序 = 挂载顺序）。 */
export const COMPOSITION: Array<{ id: string; plugin: Plugin<unknown>; config: unknown }> = [
  { id: "queue-timer", plugin: feat_queue_timer as Plugin<unknown>, config: null },
];
