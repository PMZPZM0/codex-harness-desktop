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
/* ⛔ 云端记忆「能用吗」由 cloud-memory-activation 统一判（服务端回执 + 上游意图），
   本文件只**消费**结论。⛔ 别在这里自己判「选了就当能用」—— 那正是静默丢记忆的形态。 */
import { cloudMemoryUsable, describeCloudMemoryReason, readCloudMemoryActivation } from "./cloud-memory-activation";

export type MemoryBackend = "builtin" | "mcp" | "cloud";

/** 用户选的记忆后端。惰性求值（每次读盘）——⛔ 不要在模块体里求值 userData（main.ts 的 setPath 之前读会漂移）。 */
export function memoryBackend(): MemoryBackend {
  try {
    const raw = readAppSettingsSync(app.getPath("userData")).memoryBackend;
    return raw === "cloud" ? "cloud" : raw === "mcp" ? "mcp" : "builtin";
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
  const configured = memoryBackend();
  if (configured === "cloud") {
    /* ⛔⛔ 与 MCP 同一条纪律：**用户选了不等于能用**。云端权益没开通 / 没登录 / 上游没接通时，
       对话上游仍停在纯模型端点 —— 此时若还声称 cloud，提示层会教模型"什么都不用做，云端自动收"，
       实际一条都存不下（静默丢记忆）。⇒ 回退内置，让记忆至少落在本机可读的地方。 */
    if (cloudMemoryUsable()) return "cloud";
    console.warn("[memory] 记忆后端选了云端，但云端记忆未开通/未接通 ⇒ 本轮回退内置记忆金字塔，避免记忆丢失");
    return "builtin";
  }
  if (configured !== "mcp") return "builtin";
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

/** ⛔⛔ **应用自带的 node** —— 引擎侧跑 MCP 记忆服务必须用它，**不能用 Electron 的 node**。
 *
 *  为什么（09-25 真机踩到）：better-sqlite3 按 `NODE_MODULE_VERSION`(ABI) 取预编译产物，
 *  实测 Electron 43 = **149**、自带 node 24 = **137**、系统 node 22 = **127**，三者互不通用。
 *  用 electron.exe 当 runner ⇒ 装得再好也 `Could not locate the bindings file` ⇒ 引擎侧报
 *  「local-memory 启动失败」。装（安装器也用自带 node）与跑用同一个 ABI 才自洽。
 *
 *  落点：dev = `<repo>/resources/tools/node/node.exe`（与 tray.ts 取 build/ 同法，用 getAppPath）；
 *        打包 = `<resources>/tools/node/node.exe`（extraResources 已带 tools/node）。 */
export function bundledNodePath(): string {
  /* ⛔⛔ mac 适配（10-30 审计）：两个平台的**随包 node 是两种解包布局** ——
     Windows 是 `tools/node/node.exe`，darwin 是 `tools/node/bin/node`（官方 tar.gz 原样解包，
     `install-runtimes.cjs` 的 marker 就写的 `bin/node`）。这里原先按 "node" 硬拼 ⇒ mac 得到
     `tools/node/node`（不存在）⇒ 本地记忆后端的安装命令直接 no such file，装不上。
     ⛔ 为什么不直接调 `toolchain.bundledNode()`：本文件被守卫【150】钉成**叶子模块**
     （只依赖 app-settings + cloud-memory-activation，引别的会成 require 环）。
     ⇒ 只复制「布局」这一条事实；要 spawn 请用 `toolchain.bundledNode()`（带存在性探测）。 */
  const segs = process.platform === "win32" ? ["node.exe"] : ["bin", "node"];
  return app.isPackaged
    ? path.join(process.resourcesPath, "tools", "node", ...segs)
    : path.join(app.getAppPath(), "resources", "tools", "node", ...segs);
}

/** 安装器落点（与 features/memory-rpa-ipc.ts 的调用同源，改一边要改两边）。
 *  dev = `<repo>/scripts/`；打包 = `<resources>/tools/`（package.json extraResources 带的）。 */
export function memoryInstallerPath(): string {
  const dev = path.join(app.getAppPath(), "scripts", "install-memory-mcp.cjs");
  return existsSync(dev) ? dev : path.join(process.resourcesPath, "tools", "install-memory-mcp.cjs");
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
  /** 云端记忆的开通 / 生效状态（界面据此置灰卡片并给引导；⛔ 单一来源 = cloud-memory-activation） */
  cloudActivation: CloudMemoryActivationView;
};

/** 暴露给渲染层的开通状态形状（⛔ 与 cloud-memory-activation 的对外字段逐字一致）。 */
export type CloudMemoryActivationView = {
  state: "active" | "inactive" | "unknown";
  reason: string;
  entitled: boolean;
  applied: boolean;
  checkedAt: number;
  /** 原因的人话版本（界面直接展示，⛔ 别在组件里重写一套文案） */
  reasonText: string;
};

export function memoryBackendStatus(): MemoryBackendStatus {
  const backend = memoryBackend();
  const installed = localMemoryMcpInstalled();
  const installRoot = localMemoryMcpInstallRoot();
  const cloud = readCloudMemoryActivation();
  const cloudUsable = cloud.entitled && cloud.applied;
  // ⛔ 与 effectiveMemoryBackend() 同口径（后端可用才认 MCP / 云端），但**不重复打 warn** —— 设置页会反复刷新。
  const effective: MemoryBackend = backend === "cloud"
    ? (cloudUsable ? "cloud" : "builtin")
    : backend === "mcp" && installed ? "mcp" : "builtin";
  /* ⛔ 三支分开写：`active` 但没接通讲的是"缺凭据/上游没切"，不能套用失败原因文案
     （`describeCloudMemoryReason("")` 会说出"尚未确认开通状态"，与实际相反）。 */
  const cloudFallback = backend === "cloud" && !cloudUsable
    ? (cloud.state === "unknown"
      ? "已选云端记忆，但开通状态还没确认：在「记忆后端选项」里确认一次，或去「云账号」开通。当前仍走内置金字塔，记忆不会丢。"
      : cloud.state === "active"
        ? "已选云端记忆，已开通但还没接通（缺记忆凭据或对话上游未切）：在「记忆后端选项」里点「接通云端记忆」即可。当前仍走内置金字塔，记忆不会丢。"
        : `已选云端记忆，但${describeCloudMemoryReason(cloud.reason)}：当前仍走内置金字塔（记忆不会丢）。去「云账号」处理后再选一次即可。`)
    : null;
  return {
    backend,
    effective,
    installed,
    serverPath: localMemoryMcpServerPath(),
    installRoot,
    installCommand: `"${bundledNodePath()}" "${memoryInstallerPath()}" --force`,
    fallbackReason: cloudFallback ?? (backend === "mcp" && !installed
      ? "已选 MCP，但服务未安装：当前仍走内置金字塔（宁可回退，也不让记忆一处都不写）。装好服务后重启应用即可生效。"
      : null),
    cloudActivation: {
      state: cloud.state,
      reason: cloud.reason,
      entitled: cloud.entitled,
      applied: cloud.applied,
      checkedAt: cloud.checkedAt,
      reasonText: cloud.state === "active"
        ? (cloud.applied ? "已开通并已接通" : "已开通，但尚未接通（缺凭据或上游未切）")
        : cloud.state === "unknown"
          ? describeCloudMemoryReason("")
          : describeCloudMemoryReason(cloud.reason),
    },
  };
}
