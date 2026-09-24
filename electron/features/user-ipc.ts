/**
 * user-ipc（09-21 架构改造：从 electron/main.ts 按**域**拆出，纯搬迁）
 *
 * 域：user(1) / capabilities(1)
 * 通道：capabilities:snapshot / user:name
 *
 * 代码与原地逐字一致（仅整体缩进 + 顶部 import + 文件头注释）。
 * 跨域**只读**符号经 `import … from "../main"` 取用 —— 活绑定（TS→CJS 编译成 `main_1.X` 属性访问），
 * 因此 main 里被重新赋值的 `let`（窗口句柄等）也能读到最新值。
 * 本域未使用跨域可变状态。
 * 注册时机不变：main.ts 模块加载期 import 本文件 ⇒ ipcMain.handle 立即执行。
 */
import os from "node:os";
import { ipcMain } from "electron";
import { readPersonalization } from "../personalization";
import { resolveCapabilities } from "../capability-registry";
import { nuphusBinary } from "../toolchain";
import { nuphusVisionEnv } from "../nuphus-env";
import type { CapabilityProbe } from "../capability-registry";
import { devInstructionsInput } from "../main/12-skill-discipline";
import { mcpOverrideEnabled, readMcpOverrides } from "../main/06-mcp-overrides";
import { devRuntimeSpecs, runtimeInstalled } from "./dev-runtimes";
import type { McpOverrides } from "../main";
ipcMain.handle("user:name", async () => {
  // 用户名的权威源是个性化昵称（personalization.json），重启不丢；
  // 只有未设置昵称时才回退到操作系统用户名，避免每次启动把自定义称呼覆盖回系统用户。
  try {
    const cfg = await readPersonalization();
    if (cfg?.nickname) return cfg.nickname;
  } catch { /* 忽略，走回退 */ }
  try { return os.userInfo().username || "Codex 用户"; } catch { return "Codex 用户"; }
});
async function collectCapabilityProbe(): Promise<CapabilityProbe> {
  const devInput = await devInstructionsInput();
  const mcpOverrides = await readMcpOverrides().catch(() => ({}) as McpOverrides);
  return {
    platform: process.platform,
    arch: process.arch,
    desktopSwitch: devInput.desktop,
    browserSwitch: devInput.browser,
    nuphusAvailable: Boolean(nuphusBinary()) && mcpOverrideEnabled(mcpOverrides, "nuphus"),
    nuphusVisionEnv: nuphusVisionEnv(devInput.nuphusVision).length > 0,
    visionPlugin: devInput.visionPlugin,
    imagePlugin: devInput.imagePlugin,
    playwrightCli: runtimeInstalled("playwright-cli", devRuntimeSpecs["playwright-cli"]),
    markitdown: runtimeInstalled("markitdown", devRuntimeSpecs.markitdown),
  };
}
ipcMain.handle("capabilities:snapshot", async () => {
  const probe = await collectCapabilityProbe();
  return { capabilities: resolveCapabilities(probe), at: Date.now() };
});
