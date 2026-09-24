/**
 * 记忆捕获诊断（09-22）。
 *
 * 背景：捕获链曾经**静默断掉** —— L2 日志一条都没写、memory.json 不存在、USER.md 不存在，
 * 而没有任何断言或日志能看出来（`localCapture` 的 `.catch(() => undefined)` 把一切都吞了）。
 * 所以这里把每次 turn/completed 的关键事实落盘：buffer 从哪个 key 取到、user/assistant 多长、
 * cwd 有没有、最终捕没捕。写日志本身失败绝不影响主流程。
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 512 * 1024;

export function debugMemoryCapture(entry: Record<string, unknown>) {
  try {
    const file = path.join(app.getPath("userData"), "memory-capture-debug.log");
    try { if (fs.statSync(file).size > MAX_BYTES) fs.writeFileSync(file, "", "utf8"); } catch { /* 文件不存在：继续追加 */ }
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n", "utf8");
  } catch { /* 诊断失败不影响主流程 */ }
}
