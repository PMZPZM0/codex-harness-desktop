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
import { existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { readAppSettingsSync } from "./app-settings";

export type MemoryBackend = "builtin" | "mcp";

/** 用户选的记忆后端。惰性求值（每次读盘）——⛔ 不要在模块体里求值 userData（main.ts 的 setPath 之前读会漂移）。 */
export function memoryBackend(): MemoryBackend {
  try {
    return readAppSettingsSync(app.getPath("userData")).memoryBackend === "mcp" ? "mcp" : "builtin";
  } catch {
    return "builtin"; // 读取失败（userData 未就绪等）时保守回退内置，绝不因此吞掉记忆
  }
}

/** MCP 记忆服务的安装落点与入口（与 scripts/install-memory-mcp.cjs 同源，改一边要改两边）。 */
export function localMemoryMcpServerPath(): string {
  return path.join(
    app.getPath("userData"), "memory-mcp", "node_modules", "@vheins", "local-memory-mcp", "bin", "mcp-memory-server.js",
  );
}

/** MCP 记忆服务是否**已安装**（只判入口存在，必须便宜 —— appendLesson 每次都会问）。
 *  ⛔「装了」不等于「能起来」：进程级可用性由安装器的 `--verify` 负责（真跑一次 stdio 握手）。
 *     这里刻意只做文件判定：捕获链上起进程既慢又可能卡住。 */
export function localMemoryMcpInstalled(): boolean {
  try {
    return existsSync(localMemoryMcpServerPath());
  } catch {
    return false;
  }
}

/** ⛔ **实际生效的写入后端** —— 捕获链只认这个，不认 `memoryBackend()`。
 *
 *  为什么多一层：用户选了 MCP、但服务**没装/装坏了**（用户 09-25：「我的电脑不行，用户电脑肯定也不行」——
 *  依赖原生模块 better-sqlite3 的包在禁 npm scripts / 无构建工具链 / 网络受限的环境里装不上），
 *  若此时内置也让位 ⇒ **记忆一处都不写 = 彻底丢记忆**，这比"重复"严重得多。
 *  ⇒ 选了 MCP 但不可用时**回退内置**：宁可回到金字塔，也不能丢。 */
export function effectiveMemoryBackend(): MemoryBackend {
  if (memoryBackend() !== "mcp") return "builtin";
  if (!localMemoryMcpInstalled()) {
    console.warn("[memory] 记忆后端选了 MCP，但服务未安装（入口缺失）⇒ 本轮回退内置记忆金字塔，避免记忆丢失");
    return "builtin";
  }
  return "mcp";
}

/** MCP 记忆服务的安装根目录（`<userData>/memory-mcp`，与安装器 scripts/install-memory-mcp.cjs 同源）。 */
export function localMemoryMcpInstallRoot(): string {
  return path.join(app.getPath("userData"), "memory-mcp");
}

/** 设置页「记忆后端」区块要的状态快照（09-25）。⛔ 全部惰性求值 —— 顶层不碰 `app.getPath`（【91】）。 */
export type MemoryBackendStatus = {
  /** 用户选的值（可能不可用） */
  backend: MemoryBackend;
  /** 实际生效的写入后端（带可用性回退） */
  effective: MemoryBackend;
  /** 服务入口是否存在（只判文件，便宜） */
  installed: boolean;
  serverPath: string;
  installRoot: string;
  /** 装服务的命令（给 UI 展示/复制 —— 按用户要求走「命令安装」，不做一键安装） */
  installCommand: string;
  /** 选了 MCP 却回退时的原因；没回退则为 null */
  fallbackReason: string | null;
};

export function memoryBackendStatus(): MemoryBackendStatus {
  const backend = memoryBackend();
  const installed = localMemoryMcpInstalled();
  const installRoot = localMemoryMcpInstallRoot();
  // ⛔ 与 effectiveMemoryBackend() 同口径（后端可用才认 MCP），但**不重复打 warn** —— 设置页会反复刷新。
  const effective: MemoryBackend = backend === "mcp" && installed ? "mcp" : "builtin";
  return {
    backend,
    effective,
    installed,
    serverPath: localMemoryMcpServerPath(),
    installRoot,
    installCommand: `npm install --prefix "${installRoot}" @vheins/local-memory-mcp`,
    fallbackReason:
      backend === "mcp" && !installed
        ? "已选 MCP，但服务未安装：当前仍走内置金字塔（宁可回退，也不让记忆一处都不写）。装好服务后重启应用即可生效。"
        : null,
  };
}
