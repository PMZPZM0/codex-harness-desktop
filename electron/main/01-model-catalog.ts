/**
 * main 的「model-catalog」部分（09-22 从同目录 main.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { Menu, Notification, app, BrowserWindow, clipboard, globalShortcut, ipcMain, nativeTheme, net, powerSaveBlocker, protocol, safeStorage, session, shell, systemPreferences } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { RESERVED_PROVIDER_IDS, safeProviderId, stripReservedProviderTables } from "../provider-id";
import { collectMcpServerNames, escapeTomlString, extractMcpSection, injectMcpToolRules, injectSectionExtras, preserveUserConfig, tomlBareKey, type McpToolRules } from "../config-toml";
import type { CustomModelFile, ProviderModel } from "../features/custom-model-types";
import { buildModelCatalog, probeCustomModel } from "../features/custom-model-probe";
// ⛔ 09-24 断环收尾：此处原先还 import { createPopoutWindow, createWindow } from "../features/window-factory"，
//    但两者在本文件**只出现在注释里**（死导入）—— 而 window-factory 反过来 import runtime-refs，
//    与 runtime-refs → 本文件 → window-factory 构成 require 环。删死导入即断环（保留本注释作证据）。
// ⛔ 09-24 断环：原先这些符号全部 from "../main"，使 main.ts → runtime-refs → 本文件 → main.ts 成环。
//    路径常量进叶子模块 ../runtime-paths，协议表进 ../upstream-protocols，McpOverrides 是本目录的类型，
//    escapeToml 本就是 config-toml 的 escapeTomlString 的别名（本文件已 import config-toml）。
import { codexHome, customModelFile, customModelsFile, modelCatalogFile } from "../runtime-paths";
import { syncUpstreamProtocols } from "../upstream-protocols";
import type { McpOverrides } from "./06-mcp-overrides";
export async function readCustomModel(): Promise<CustomModelFile | null> {
  try {
    return JSON.parse(await fs.readFile(customModelFile, "utf8"));
  } catch (error: any) {
    if (error.code === "ENOENT") return null;
    // ⛔ 绝不 throw（09-13 审计 P0）：这个函数在启动链上被裸 await，而它前面就是
    // `createWindow()` —— 一旦文件被写坏（非原子写/断电/并发写撞车），异常会掐断整条
    // `app.whenReady().then(...)`（那条链没有 .catch），**窗口根本不创建**：双击没反应、
    // 连引导页都不出现，用户只能手工删 %APPDATA% 下的文件才能再用。
    // 现在的语义：解析失败 → 把坏文件改名留证 + 当"没配置"继续启动（用户看到提示，可重配）。
    try {
      const bad = `${customModelFile}.bad-${Date.now()}`;
      await fs.rename(customModelFile, bad);
      console.warn(`[custom-model] 配置损坏，已备份为 ${bad} 并按空配置继续启动：`, error?.message ?? error);
    } catch (renameError) {
      console.warn("[custom-model] 配置损坏且备份失败，按空配置继续启动：", error?.message ?? error);
    }
    return null;
  }
}

export async function readCustomModels(): Promise<CustomModelFile[]> {
  try {
    const list: CustomModelFile[] = JSON.parse(await fs.readFile(customModelsFile, "utf8"));
    const normalized = list.map(normalizeProvider);
    // 读到即是真相：顺手同步「上游协议」映射（启动后第一次读就自动建立，不需要额外启动钩子）
    syncUpstreamProtocols(normalized);
    return normalized;
  } catch { return []; }
}

export async function writeCustomModels(list: CustomModelFile[]) {
  // 写前备份（09-16）：档案清单出现过整份清空（custom-models.json → []）且无法从代码路径定责，
  // 留一份上一版内容随时可手工回滚——备份本身幂等，只在上一版非空时覆盖。
  try {
    const previous = await fs.readFile(customModelsFile, "utf8");
    if (previous.trim() && previous.trim() !== "[]") await fs.writeFile(`${customModelsFile}.bak`, previous, "utf8");
  } catch { /* 首次写入没有旧文件，跳过 */ }
  await fs.writeFile(customModelsFile, JSON.stringify(list, null, 2), "utf8");
  // ⛔ 同步「上游协议」内存映射：写档案是设置变化的唯一出口，挂这里就不会漏
  //   （漏了的表现是「用户改了协议设置但桥还按老协议走」）。
  syncUpstreamProtocols(list);
}

// 保留 provider id 的处理统一在 ./provider-id（独立模块：渠道机器人、团队服务也要用，
// 放这里会循环依赖）。背景见 electron/provider-id.ts 与 09-19 真实用户事故说明。

/** 删掉 config.toml 里**保留 id** 的 provider 段 —— 实现已抽到 ./provider-id（三个模块共用）。 */

/**
 * 保留 provider id 自愈（09-19 真实用户事故）。
 *
 * 老版本允许把供应商 id 存成 `openai` —— 而 `openai` 是引擎的**内置保留 id**，写出的
 * `[model_providers.openai]` 会让引擎**整份拒绝加载 config.toml**：
 *   `model_providers contains reserved built-in provider IDs: openai`
 * 症状是"发消息就报错"，且**与用哪个模型无关**（配 DeepSeek 官网也一样挂）。
 *
 * 这里做两件事（幂等、失败不阻塞启动）：
 *   ① 档案里 provider 是保留 id 的条目 → 改名并落盘（openai → openai-custom）；
 *   ② config.toml 里已写坏的保留 id 段 → 整段删除（宁可少一段，也不能让整份配置拒载）。
 * 之后用户切供应商/保存配置时会按安全 id 重写一份权威配置。
 */
export async function healReservedProviderConfig(): Promise<void> {
  try {
    // ⛔ 必须看**原始文件**里的 provider：readCustomModels() 回来的已经过 normalizeProvider
    //   （provider 早被改名）——拿它比较会让 needsRename 恒为 false，落盘变成死代码（实测踩过）。
    const raw = await fs.readFile(customModelsFile, "utf8").catch(() => "");
    const rawList: Array<{ provider?: string }> = raw ? JSON.parse(raw) : [];
    const needsRename = Array.isArray(rawList) && rawList.some((entry) => safeProviderId(entry?.provider) !== entry?.provider);
    if (needsRename) {
      const fixed = rawList.map((entry) => normalizeProvider({ ...(entry as CustomModelFile), provider: safeProviderId(entry?.provider) } as CustomModelFile));
      await writeCustomModels(fixed);
      console.warn("[boot] 供应商 id 占用了引擎保留名，已自动改名:", rawList.map((e) => e?.provider).filter((p) => safeProviderId(p) !== p).join(", "));
    }
    const file = path.join(codexHome, "config.toml");
    const text = await fs.readFile(file, "utf8").catch(() => "");
    if (!text) return;
    const cleaned = stripReservedProviderTables(text);
    if (cleaned !== text) {
      await fs.writeFile(file, cleaned, "utf8");
      console.warn("[boot] config.toml 含引擎保留 provider id 段，已清理（否则整份配置拒载）");
    }
  } catch (error) {
    console.warn("[boot] healReservedProviderConfig failed (降级继续):", error);
  }
}

/** 老版本 models 是 string[]，统一迁移成 ProviderModel[]；并确保生效 model 在列表里 */
export function normalizeProvider(entry: CustomModelFile): CustomModelFile {
  const models = (entry.models ?? []).map((raw: any): ProviderModel => typeof raw === "string" ? { id: raw, contextWindow: entry.contextWindow, enabled: true } : { ...raw, enabled: raw?.enabled !== false }).filter((m) => m && typeof m.id === "string" && m.id);
  if (entry.model && !models.some((m) => m.id === entry.model)) models.unshift({ id: entry.model, contextWindow: entry.contextWindow, enabled: true });
  // ⛔ wire_api 归一化：新版引擎对 "chat" **硬拒载**。档案（custom-model.json）里残留的 chat
  // 必须在这里就消掉 —— 否则「删掉供应商、重新配置」也清不掉它，每次写 config.toml 都会把
  // 坏值带回去（09-14 用户实测：删了重配仍报同一条错）。这里归一化后，写入侧恒为 responses。
  // 09-16 用独立 CODEX_HOME + 真实 app-server 复核过（scripts/probe-wire-api.cjs）：config.toml
  // 写 chat 时 initialize 能过、**turn/start 必报** `wire_api = "chat"` is no longer supported.
  // How to fix: set `wire_api = "responses"` in your provider config. → 每个请求都失败。
  // 所以归一化不是「顺手做的」，是保命逻辑；UI 侧对应地把 Chat Completions 选项撤掉。
  // ⛔ 保留 id 迁移（09-19 真实用户事故）：档案里存着 `openai` 时，写出的 `[model_providers.openai]`
  //    会让引擎**整份拒载 config.toml**（所有请求全失败）。在唯一的归一化入口改名，
  //    读档案 / 写配置 / 界面显示三处因此永远一致。
  return { ...entry, provider: safeProviderId(entry.provider), models, wireApi: "responses" };
}

/** 合并去重保序，model 始终在列表最前 */

/**
 * 拆出「用户自己管的配置」+「用户手工写的 MCP 段」。
 * mcp_servers 永远不进 preserved：harness 自己会重新生成连接器与内置 nuphus，
 * 用户手工写的那些则由覆盖表决定是否原样拼回（并顺手把原文记进覆盖表）。
 */
export async function readUserConfigSplit(ownedMcpServers: Set<string>, overrides: McpOverrides) {
  let raw = "";
  try { raw = await fs.readFile(path.join(codexHome, "config.toml"), "utf8"); }
  catch (error: any) { if (error.code !== "ENOENT") throw error; }
  const preserved = preserveUserConfig(raw);
  const found: Record<string, string> = {};
  for (const name of new Set([...collectMcpServerNames(raw), ...Object.keys(overrides)])) {
    // ⛔ 子段也算 owned：`[mcp_servers.harness-dispatch.env]` 的名字是 "harness-dispatch.env"，
    // 精确匹配会漏 → 被当成用户段拼回 → 与新生成的段重复（09-16 实测 duplicate key，MCP 全灭）。
    const ownedBase = name.split(".")[0];
    if (ownedMcpServers.has(name) || ownedMcpServers.has(ownedBase)) continue;
    const text = extractMcpSection(raw, name) || overrides[name]?.toml || "";
    if (!text) { delete overrides[name]; continue; } // 原文已丢且没存档，清掉这条死记录
    overrides[name] = { enabled: overrides[name]?.enabled !== false, toml: text, permissions: overrides[name]?.permissions };
    if (overrides[name].enabled) found[name] = text;
  }
  return { preserved, mcpExtra: Object.values(found) };
}

export async function writeModelCatalogToml(entry: CustomModelFile): Promise<string> {
  const savedProviders = await readCustomModels();
  const providers = [entry, ...savedProviders.filter((candidate) => candidate.provider !== entry.provider)];
  const seen = new Set<string>();
  const models = providers.flatMap((candidate) => buildModelCatalog(candidate).models).filter((m) => !seen.has(m.slug) && seen.add(m.slug));
  if (!models.length) return "";
  await fs.writeFile(modelCatalogFile, JSON.stringify({ models }, null, 2), "utf8");
  return `model_catalog_json = "${escapeTomlString(modelCatalogFile)}"`;
}
