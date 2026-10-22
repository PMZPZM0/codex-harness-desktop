/**
 * 工具持久化清单（10-12 新增板块）—— 修「更新后手动装的工具全没了」。
 *
 * ⛔⛔ **问题根因（一句话）**：打包态下 `toolsRoot()` = `process.resourcesPath/tools`
 *   （`electron/toolchain.ts`），也就是**安装目录内部**。内置工具由 electron-builder 的
 *   `extraResources` 随安装包重新铺一遍，所以更新后必然「回来」；
 *   而用户**按需下载**的工具（git / ffmpeg / pwsh / markitdown …）
 *   是直接写进这个目录的 —— Windows 覆盖安装会重建整个安装目录 ⇒ 它们被一起抹掉。
 *   代码里对此**没有任何补偿**：清单（`devRuntimeSpecs`）只描述「有哪些工具」，
 *   不描述「用户装过哪些」，于是每次更新后这些工具一律回到「未安装」。
 *
 * **方案：把「装过什么」这件事从安装目录搬出去，落到 userData。**
 *   · 本模块只管**记账与恢复决策**，不碰下载、不碰 UI；
 *   · 真实安装/校验口径仍归 `dev-runtimes.ts`（单一真相源，不复制一份判据）；
 *   · 路径语义（marker 的相对路径解析）也从那边取，避免两处漂移。
 *
 * ⛔ **惰性求值（【91】）**：`app.getPath("userData")` **绝不在模块体**取 ——
 *   本模块被 import 的时机早于 `app.setPath("userData", …)`（main.ts 模块体），
 *   在模块体里取会静默拿到默认目录（路径漂移，症状是清单写到别处）。
 *   下面所有取路径的函数都在**调用时**才求值。
 *
 * ⛔ 清单读写失败**永不抛**：账本坏了最多退化成「按未安装处理，用户点一下装」，
 *   绝不能因为一次 JSON 解析失败就让整个应用起不来。
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/** 清单文件名（放 userData 根；与 update-source.json 同一层，都是「用户自己的数据」）。 */
const MANIFEST_FILE = "installed-tools.json";
/** 清单格式版本：结构变了走 migrate，不做静默兼容。 */
const MANIFEST_VERSION = 1;

/** 一条安装记录。`id` 与 `devRuntimeSpecs` 的键一一对应。 */
export type InstalledToolRecord = {
  id: string;
  /** 首次装上的时间（ISO）。用于界面展示与排障，不参与判定。 */
  installedAt: string;
  /** 最近一次确认「文件确实在」的时间（ISO）。 */
  lastVerifiedAt?: string;
  /** 当时的版本串（若该工具能报出版本）；拿不到就空串。 */
  version?: string;
  /**
   * 当时工具文件所在位置（相对 `toolsRoot()`）。
   * ⛔ 保留它是为了将来把工具**真搬到 userData** 时能无缝迁移（见文件末尾「演进方向」）。
   */
  relPath?: string;
};

/** 清单全文。 */
type ToolManifest = {
  version: number;
  updatedAt: string;
  tools: Record<string, InstalledToolRecord>;
};

/** 惰性取清单文件路径。 */
function manifestPath(): string {
  return path.join(app.getPath("userData"), MANIFEST_FILE);
}

/** 空清单（从不抛）。 */
function emptyManifest(): ToolManifest {
  return { version: MANIFEST_VERSION, updatedAt: new Date().toISOString(), tools: {} };
}

/** 读清单（坏文件当空，不抛）。 */
export function readToolManifest(): ToolManifest {
  try {
    const raw = fs.readFileSync(manifestPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ToolManifest>;
    if (!parsed || typeof parsed !== "object" || !parsed.tools || typeof parsed.tools !== "object") {
      return emptyManifest();
    }
    return { version: Number(parsed.version) || MANIFEST_VERSION, updatedAt: String(parsed.updatedAt ?? ""), tools: parsed.tools as Record<string, InstalledToolRecord> };
  } catch {
    return emptyManifest();
  }
}

/** 写清单（失败只记不抛——账本不是关键路径）。 */
function writeToolManifest(manifest: ToolManifest): boolean {
  try {
    const file = manifestPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // ⛔ 先写临时文件再改名：断电/崩溃时不会留下半截 JSON（那会让下次读清单直接当空 ⇒ 全员「未安装」）。
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8" });
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * 记一笔「用户装了这个工具」。
 * @param id 工具 id（`devRuntimeSpecs` 的键）
 * @param relPath 工具相对 `toolsRoot()` 的路径；不知道就留空
 */
export function recordToolInstalled(id: string, relPath?: string, version?: string): void {
  const manifest = readToolManifest();
  const now = new Date().toISOString();
  manifest.tools[id] = {
    id,
    installedAt: manifest.tools[id]?.installedAt ?? now,
    lastVerifiedAt: now,
    ...(version ? { version } : {}),
    ...(relPath ? { relPath } : {}),
  };
  manifest.version = MANIFEST_VERSION;
  manifest.updatedAt = now;
  writeToolManifest(manifest);
}

/** 记一笔「这个工具没了」（卸载、或校验发现文件已不存在）。 */
export function recordToolRemoved(id: string): void {
  const manifest = readToolManifest();
  if (!(id in manifest.tools)) return;
  delete manifest.tools[id];
  manifest.updatedAt = new Date().toISOString();
  writeToolManifest(manifest);
}

/** 某工具是否在账本里（**不**代表文件存在 —— 那要看 `dev-runtimes` 的 `runtimeInstalled`）。 */
export function isToolRecorded(id: string): boolean {
  return id in readToolManifest().tools;
}

/** 账本里记过的全部 id（供界面做「更新后需要重装」的提示）。 */
export function recordedToolIds(): string[] {
  return Object.keys(readToolManifest().tools);
}

/** 批量刷新「已确认存在」的标记（文件在就更新时间戳）。 */
export function verifyRecordedTools(presentIds: string[]): void {
  const manifest = readToolManifest();
  const now = new Date().toISOString();
  let touched = false;
  for (const id of presentIds) {
    const rec = manifest.tools[id];
    if (rec) { rec.lastVerifiedAt = now; touched = true; }
  }
  if (touched) { manifest.updatedAt = now; writeToolManifest(manifest); }
}

/**
 * 更新后要重装哪些工具：**账本记过、但这次文件确实不在了**的那些。
 *
 * ⛔ 判据说明（为什么必须两个条件都满足）：
 *   - 只看「账本记过」⇒ 会把**内置/随包**工具也报成待重装（它们随安装包回来，本就不该重装）；
 *     ⇒ 调用方必须先按 `builtIn` / `bundled` 过滤掉内置项（见 `dev-runtimes` 的 specs）。
 *   - 只看「文件不在」⇒ 把用户**从来没装过**的工具也报成待重装（首次启动全是「不在」）。
 *   两个条件合起来 = 「装过 + 该装 + 现在没了」。
 */
export function toolsNeedingReinstall(installedIds: string[]): string[] {
  const manifest = readToolManifest();
  return installedIds.filter((id) => id in manifest.tools);
}

/**
 * 演进方向（本版**不做**，写下来免得后人重新推一遍）：
 *   真正省事的做法是把按需下载的工具改到 **userData** 下的独立根（如 `<userData>/tools/`），
 *   `augmentedPath()` 同时把两个根都拼进 PATH —— 那样更新天然不丢，连清单都不需要。
 *   本版先上清单（改动面小、纯记账），等观察一版再决定是否搬目录。
 */