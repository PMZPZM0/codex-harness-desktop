/**
 * 记忆后端判定（09-25）。
 *
 * ⛔ 为什么单独一个叶子文件：runtime-refs.ts **已经 import 了 memory-layers**（`MemoryLayers`），
 *    若把后端判定放进 runtime-refs、再让 memory-layers 反向 import 它 ⇒ 形成 require 环
 *    （tsc 不报错，但 CJS 下可能拿到未初始化的绑定，守卫【147】正是钉这条）。
 *    所以判定放在这个只依赖 `electron` + `app-settings` 的**叶子模块**，两边都能安全正向引用。
 *
 * 二选一（用户 09-25 明确「不要重复」）：
 *   - "builtin"（默认）：内置记忆金字塔（L0~L7 + 纪律/坑分类写入）。
 *   - "mcp"：优先用 MCP 记忆服务（@vheins/local-memory-mcp，可选安装，不内置）；
 *     此时内置金字塔**停止捕获写入**（`MemoryLayers.appendLesson` 会让位）。
 */
import { app } from "electron";
import { readAppSettingsSync } from "./app-settings";

export type MemoryBackend = "builtin" | "mcp";

/** 当前记忆后端。惰性求值（每次读盘）——⛔ 不要在模块体里求值 userData（main.ts 的 setPath 之前读会漂移）。 */
export function memoryBackend(): MemoryBackend {
  try {
    return readAppSettingsSync(app.getPath("userData")).memoryBackend === "mcp" ? "mcp" : "builtin";
  } catch {
    return "builtin"; // 读取失败（userData 未就绪等）时保守回退内置，绝不因此吞掉记忆
  }
}
