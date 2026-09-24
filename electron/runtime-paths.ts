/**
 * 运行时路径（叶子模块，2026-09-24 断环用）。
 *
 * ⛔ 存在的理由：`main.ts → runtime-refs.ts → main/01-model-catalog.ts → main.ts` 是个环；
 *    而 01-model-catalog 需要的正是这些 userData 下的路径常量。若把它们放进
 *    `runtime-refs.ts`，`runtime-refs` 又要 import 01-model-catalog（upsertCustomModel 用
 *    readCustomModels/writeCustomModels）⇒ 新环。故路径单独成**叶子模块**（不 import 任何
 *    业务模块），谁都能安全依赖。
 *
 * ⛔【91】凡依赖 app.getPath("userData") 的路径都在 initRuntimePaths() 里赋值：
 *    main.ts 必须在 app.setPath("userData") 之后**立即**调用它（自身带 once 保护）。
 */
import { app } from "electron";
import path from "node:path";

export let codexHome = "";
export let customModelFile = "";
export let customModelsFile = "";
export let channelBotFile = "";
export let botStreamFile = "";
export let memoryGatewayFile = "";
export let pastedTextDir = "";
export let memoryWorkspaceFile = "";
export let modelCatalogFile = "";
/* 09-24 收尾：下列 5 个原在 main.ts，被 main/02..12 反向 import ⇒ 一并下沉（断环无尾巴）。 */
export let memoryModeFile = "";
export let mcpOverridesFile = "";
export let connectorsFile = "";
export let builtinPluginsFile = "";
export let subAgentsFile = "";

let ready = false;
export function initRuntimePaths() {
  if (ready) return;
  ready = true;
  const userData = app.getPath("userData");
  codexHome = path.join(userData, "codex-home");
  customModelFile = path.join(userData, "custom-model.json");
  customModelsFile = path.join(userData, "custom-models.json");
  channelBotFile = path.join(userData, "channel-bot.json");
  botStreamFile = path.join(userData, "bot-stream.json");
  memoryGatewayFile = path.join(userData, "memory-gateway.json");
  pastedTextDir = path.join(userData, "pasted-text");
  memoryWorkspaceFile = path.join(userData, "memory-workspaces.json");
  modelCatalogFile = path.join(codexHome, "model-catalog.json");
  memoryModeFile = path.join(userData, "memory-mode.json");
  mcpOverridesFile = path.join(userData, "mcp-server-overrides.json");
  connectorsFile = path.join(userData, "connectors.json");
  builtinPluginsFile = path.join(userData, "builtin-plugins.json");
  subAgentsFile = path.join(userData, "sub-agents.json");
}
