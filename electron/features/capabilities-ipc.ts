/**
 * capabilities-ipc（10-03 从 `features/user-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：capabilities(1)
 * 通道：capabilities:snapshot
 *
 * 为什么拆出来：原 `user-ipc.ts` 一个板块承载 `user` + `capabilities` 两个前缀，
 * 违反「一个板块恒等于一个域前缀」（10-03 用户令：功能必须独立板块）。
 *
 * 能力探针的口径集中在 `../capability-registry` 的 `resolveCapabilities`（单一真相源），
 * 本域只负责把环境探测结果组装成 `CapabilityProbe` 交给它判定。
 *
 * 生命周期：通道在 `setup` 内注册、`ctx.effect` 内摘除；注册时机由组合表决定（本文件不自挂载）。
 */
import { resolveCapabilities } from "../capability-registry";
import { computerUseLauncher, harnessUiaServer, nuphusBinary } from "../toolchain";
import { nuphusVisionEnv } from "../nuphus-env";
import type { CapabilityProbe } from "../capability-registry";
import { devInstructionsInput } from "../main/12-skill-discipline";
import { mcpOverrideEnabled, readMcpOverrides } from "../main/06-mcp-overrides";
import { devRuntimeSpecs, runtimeInstalled } from "./dev-runtimes";
import type { McpOverrides } from "../main";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

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
    // 两条新后端只看"随包文件在不在"，不看总闸（闸门由 resolveCapabilities 统一判）
    uiaAvailable: Boolean(harnessUiaServer()),
    computerUseAvailable: Boolean(computerUseLauncher()),
    visionPlugin: devInput.visionPlugin,
    imagePlugin: devInput.imagePlugin,
    playwrightCli: runtimeInstalled("playwright-cli", devRuntimeSpecs["playwright-cli"]),
    markitdown: runtimeInstalled("markitdown", devRuntimeSpecs.markitdown),
  };
}

export const capabilitiesFeature = defineFeature<null>({
  id: "capabilities",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("capabilities: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("capabilities:snapshot", async () => {
      const probe = await collectCapabilityProbe();
      return { capabilities: resolveCapabilities(probe), at: Date.now() };
    });

    ctx.effect(() => {
      ipcHost.removeHandler("capabilities:snapshot");
    });
  },
});
