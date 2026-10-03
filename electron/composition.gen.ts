/* ⛔ 本文件由 scripts/gen-domain-registry.mjs 生成，禁手改。
   改"启用哪些域"请改 electron/composition.json，然后跑：npm run gen:domains
   守卫【253】逐字节比对生成物与 renderRegistry() 的产物 —— 手改过、或改了配置没重跑，都会红。 */
import "./ipc-host"; // 先 provide "ipc" 服务（域的 inject 依赖），再挂载
import type { Plugin } from "./context";
import { mountFeature } from "./context";
import { queueTimerFeature as feat_queue_timer } from "./features/queue-timer-ipc";
import { clipboardFeature as feat_clipboard } from "./features/clipboard-ipc";
import { phoneHarnessFeature as feat_phone } from "./features/phone-harness-ipc";
import { updatesFeature as feat_updates } from "./features/updates-ipc";
import { dataDirFeature as feat_dataDir } from "./features/data-dir-ipc";

export type EnabledDomain = { id: string; plugin: Plugin<unknown>; config: unknown };

/** 已启用的域（顺序 = composition.json 里的顺序 = 挂载顺序）。
 *  ⛔⛔ 依赖方向恒为 **本生成物 → 域**：域**绝不 import 本文件** —— 反向就是环，
 *     CJS 下 domain 还没求值完 ⇒ plugin 为 undefined ⇒ 启动即崩（10-03 实测事故）。
 *     挂载在**模块作用域**执行 = 与原 import "./features/xxx" 同时机，不改变启动顺序。
 *  ⛔⛔ 本函数体是**模板字符串**：里面**绝不能出现反引号**（会把模板提前闭合 ⇒ 生成器语法错误）。 */
export const ENABLED: EnabledDomain[] = [
  { id: "queue-timer", plugin: feat_queue_timer as Plugin<unknown>, config: null },
  { id: "clipboard", plugin: feat_clipboard as Plugin<unknown>, config: null },
  { id: "phone", plugin: feat_phone as Plugin<unknown>, config: null },
  { id: "updates", plugin: feat_updates as Plugin<unknown>, config: null },
  { id: "dataDir", plugin: feat_dataDir as Plugin<unknown>, config: null },
];

for (const row of ENABLED) mountFeature(row.plugin, row.config);
