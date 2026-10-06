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
import { readCustomModel } from "./01-model-catalog";
import { server } from "../runtime-refs";
import { outputStyleTargets } from "../output-styles";
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
    /* 输出风格（10-06）：控制台「回复风格」开关打开的写作风格技能 —— 宿主把它翻译成
       **常驻指令**下发，这样开关一开就每轮生效，不必用户点名（见 electron/output-styles.ts）。
       ⛔ 判据是技能池的全局停用集（与开关同一份真相源），不在这里另存状态。 */
    outputStyles: outputStyleTargets(codexHome),
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

/**
 * 把 developer_instructions **重新落地**（10-06：输出风格开关变化后调用）。
 *
 * ⛔⛔ 必须整份重写 config.toml + 重启引擎，不能只改文件：
 *   引擎在 **spawn 时**读一次 config.toml，进程内改文件它完全看不见
 *   ⇒ 只改文件 = 用户点开开关却毫无变化（正是 10-06 用户报的「开了没反应」的同族形态，
 *     与本仓 09-25「删掉写入 ≠ 清掉已写下的值」一样，属"改了没生效"那一类）。
 *   与「能力总闸」（桌面/浏览器自动化）完全同一条链：`applyCustomModel(model)`；没配模型时
 *   退化为 `server.restart()`（口径抄自 connectors-ipc / mcp-servers-ipc，别自创第三条）。
 * ⛔ 失败一律不抛：调用方是设置页开关，指令刷新失败不该让"开关本身"看上去失败。
 */
export async function refreshDeveloperInstructions(): Promise<void> {
  try {
    const model = await readCustomModel();
    if (model) await applyCustomModel(model);
    else await server.restart();
  } catch (error: any) {
    console.warn("developer_instructions 刷新失败:", error?.message ?? error);
  }
}
