/** 启动耗时打点（09-17 为「先测再定」的加载动画方案做量化依据）。
 *
 *  为什么要有这个模块：加载动画值不值得做、做在哪一段，取决于**启动各阶段到底多慢**。
 *  尤其「窗口已显示但页面还没画出来」这段白窗期，只能从主进程侧测 —— 渲染层的
 *  performance.now() 起点太晚，看不见它。
 *
 *  设计：进程级单例，t0 = 本模块被 import 的时刻（≈ 主进程 JS 开始执行）。
 *  各阶段只累加时间戳，落盘到 userData/boot-timing.json（只留最近 20 次，追加不覆盖）。
 *  落盘失败一律吞掉 —— 测量代码绝不能影响启动本身。
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const t0 = Date.now();
const marks = new Map<string, number>();
let flushed = false;

/** 记录一个阶段耗时点（同名后写覆盖，便于重入场景取最后一次）。 */
export function markBoot(name: string): void {
  marks.set(name, Date.now() - t0);
}

/** 取当前打点快照（毫秒，相对 t0）。 */
export function bootMarks(): Record<string, number> {
  return Object.fromEntries(marks);
}

/** 把打点写入 userData/boot-timing.json（每次启动一条，保留最近 20 条）。 */
export function flushBootTiming(): void {
  if (flushed) return;
  flushed = true;
  try {
    const file = path.join(app.getPath("userData"), "boot-timing.json");
    let history: unknown[] = [];
    try { history = JSON.parse(fs.readFileSync(file, "utf8")) as unknown[]; } catch { /* 首次或坏文件 */ }
    if (!Array.isArray(history)) history = [];
    history.push({
      at: new Date().toISOString(),
      // 相对 t0 的毫秒；t0 = 主进程 JS 开始执行
      ms: bootMarks(),
    });
    fs.writeFileSync(file, JSON.stringify(history.slice(-20), null, 2));
  } catch {
    /* 测量代码不影响启动 */
  }
}
