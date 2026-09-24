/**
 * main 的「skill-discipline」部分（09-22 从同目录 main.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { Menu, Notification, app, BrowserWindow, clipboard, globalShortcut, ipcMain, nativeTheme, net, powerSaveBlocker, protocol, safeStorage, session, shell, systemPreferences } from "electron";
import path from "node:path";
import { readAppSettings, readAppSettingsSync, saveAppSettings, type AppSettings } from "../app-settings";
import { upsertSkillDiscipline, DISCIPLINE_START, DISCIPLINE_END } from "../skill-discipline";
import { augmentedPath, bundledGit, bundledNode, bundledPython, CHINA_NPM_REGISTRY, cloakCacheDir, cloakOpenHelper, downloadEnv, nuphusBinary, npmGlobalRoot, toolchainEnv, toolsRoot } from "../toolchain";
import { applyCustomModel } from "../features/custom-model-apply";
import { readConnectors } from "./07-connectors-io";
import { readBuiltinPlugins } from "./09-agents-plugins";
import { codexHome } from "../runtime-paths";
/**
 * developer_instructions 的组装输入（**单一来源**）。
 * ⛔ applyCustomModel 的「写出」与启动自愈的「是否过期」判定必须共用这一个函数（09-20 修）。
 *   旧判据是 `!configText.includes("Never infer Python availability")` —— 这句老配置里本来就有
 *   ⇒ `instructionsOutdated` **恒为 false** ⇒ 升级后 developer_instructions 永不刷新，
 *   任何指令/技能接线改动都到不了老用户（本轮实测：改完指令，真机 config.toml 里仍是旧文案，
 *   技能文件已更新 —— 只刷新一半，最难发现的那种）。
 *   反向也危险：两边输入一旦不同就会恒为 true ⇒ 每次启动整份重写 config.toml（09-16 踩过）。
 *   所以这里只做「读设置 → 算输入」，纯函数式、无副作用、两处共用。
 */
export async function devInstructionsInput() {
  const appSettings = await readAppSettings(app.getPath("userData"));
  // 自动化总闸（设置页「常规」）：桌面=nuphus MCP，浏览器=playwright/cloakbrowser 指令 + browser_use
  const builtinPlugins = await readBuiltinPlugins();
  const bundledNodePath = bundledNode();
  const mediaHelper = path.join(toolsRoot(), "harness-media.mjs");
  return {
    desktop: appSettings.desktopAutomation !== false,
    browser: appSettings.browserAutomation !== false,
    // 内置媒体插件（生图/视觉）：配置并启用后注入命令行用法，引擎（含老会话）由此「看见」并真实调用
    imagePlugin: Boolean(builtinPlugins.image?.enabled !== false && builtinPlugins.image?.baseUrl && builtinPlugins.image?.apiKey && builtinPlugins.image?.model),
    visionPlugin: Boolean(builtinPlugins.vision?.enabled !== false && builtinPlugins.vision?.baseUrl && builtinPlugins.vision?.apiKey && builtinPlugins.vision?.model),
    // nuphus 侧要的是**真实值**（baseUrl/apiKey/model 原样下发成 NUPHUS_MCP_VISION_*），
    // 不是上面那个布尔。走同一个来源，改插件配置时两边一起变（见 nuphus-env.ts 的背景说明）。
    nuphusVision: builtinPlugins.vision,
    mediaCommand: bundledNodePath ? `"${bundledNodePath}" "${mediaHelper}"` : `node "${mediaHelper}"`,
  };
}

// SkillHub 榜单分类（技能中心 tab → showcase section）；其余分类名一律落回 hot

/** 技能/连接器变化后刷新 AGENTS.md 里的「技能与 MCP 运用守则」区间（引擎每会话注入，
 *  模型开局即知当前军火库）。任何失败都不影响主流程。 */
export async function refreshSkillDiscipline() {
  try {
    const connectors = await readConnectors();
    const mcp = connectors
      .filter((c) => c.enabled !== false)
      .map((c) => ({ name: c.name, desc: c.transport === "stdio" ? `本地 MCP（${String(c.command ?? "")}）` : `HTTP MCP（${String(c.url ?? "")}）` }));
    await upsertSkillDiscipline(codexHome, mcp);
  } catch (error: any) {
    console.warn("技能纪律注入失败:", error?.message ?? error);
  }
}
