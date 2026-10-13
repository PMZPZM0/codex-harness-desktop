// 内置 ponytail 插件：随包分发 + 首启种子（全部幂等）。
//
// 背景：0.0.5 之前插件本体与 marketplace 注册段都不随包——开发机 config.toml 里
//   [marketplaces.ponytail] / [plugins."ponytail@ponytail"] 靠 preserveUserConfig 从
//   历史文件拼回，新机器 config 从零生成 → 引擎根本不知道 ponytail → 插件 0、钩子空。
// 本模块做三件事：
//   1) resources/tools/ponytail-plugin → codexHome/plugins/cache/ponytail/ponytail/<ver>/
//      （引擎安装落点。实测：cache 就位后即使 marketplace git 拉取失败，钩子照常加载）
//   2) config.toml 缺注册段时 append [marketplaces.ponytail]（source_type="local"，
//      指向随包目录）+ [plugins."ponytail@ponytail"] enabled = true
//   3) 写 hooks.state trusted_hash：不写则 SessionStart 钩子 untrusted、不执行
//      （实测：无 trusted_hash 钩子也列出，但执行被信任门禁拦住）
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

// 随包插件的固定版本目录名（引擎安装落点 = plugins/cache/<市场>/<插件>/<版本>）。
export const PONYTAIL_VERSION = "4.9.0";

/** ponytail 在引擎安装落点下的版本根目录（`<codexHome>/plugins/cache/<市场>/<插件>/<版本>`）。 */
export function ponytailCacheRoot(codexHome: string): string {
  return path.join(codexHome, "plugins", "cache", "ponytail", "ponytail");
}

/**
 * 读**引擎安装落点里实际存在**的 ponytail 版本（不排序；空数组 = 一个都没装）。
 *
 * ⛔⛔ 别拿随包常量 `PONYTAIL_VERSION` 当「当前版本」：在线更新装的是**按标签命名**的目录
 *    （`…/ponytail/ponytail/5.2.0`），与随包版本（4.9.0）不同名。只报常量会让控制台的
 *    那一行永远停在「4.9.0 → v5.2.0（有可用更新）」——更新成功了也不刷新、版本号不动
 *    （10-13 用户实测：磁盘上只剩 5.2.0，界面仍报 4.9.0）。
 *    随包常量只回答「随包的是什么」，不回答「**装的是什么**」。
 *    版本大小比较不在本文件做：单一真相源是 `electron/updates.ts` 的 `compareVersions`。
 */
export async function listInstalledPonytailVersions(codexHome: string): Promise<string[]> {
  const root = ponytailCacheRoot(codexHome);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const versions: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const yaml = await fs.readFile(path.join(root, entry.name, "plugin.yaml"), "utf8").catch(() => "");
    // 优先读插件自报版本；yaml 缺失/损坏时退回目录名（目录名就是版本，引擎按它装）
    const version = /^version:\s*(\S+)/m.exec(yaml)?.[1];
    if (version) versions.push(version);
    else if (/^\d/.test(entry.name)) versions.push(entry.name);
  }
  return Array.from(new Set(versions));
}

// 钩子脚本的 sha256（引擎按内容算，4.9.0 固定）。来源：开发机 config.toml 已验证值。
const PONYTAIL_HOOK_TRUSTED_HASH =
  "sha256:5f81d38f47448a1581c08ec877e044d9e04dd6f814dce3f2671f7a8edadd719b";

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue; // 本地安装不需要 git 元数据
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

/**
 * 把随包 ponytail 插件种子到引擎安装落点。目标目录已有完整插件（plugin.json 存在且
 * plugin.yaml 版本一致）则跳过；版本不一致（升级内置包）则整目录覆盖。
 */
async function seedPluginCache(bundledDir: string, codexHome: string, version: string): Promise<string | null> {
  const destRoot = path.join(codexHome, "plugins", "cache", "ponytail", "ponytail", version);
  try {
    const srcPluginYaml = await fs.readFile(path.join(bundledDir, "plugin.yaml"), "utf8").catch(() => "");
    const srcVersion = /^version:\s*(\S+)/m.exec(srcPluginYaml)?.[1];
    const destPluginYaml = await fs.readFile(path.join(destRoot, "plugin.yaml"), "utf8").catch(() => "");
    const destVersion = /^version:\s*(\S+)/m.exec(destPluginYaml)?.[1];
    if (destVersion === version && srcVersion === version) {
      return destRoot; // 已就位，幂等跳过
    }
    // 版本不符：先清掉旧内容再拷贝（引擎对同名同版本目录的残留会误判已安装）
    await fs.rm(destRoot, { recursive: true, force: true });
    await copyDir(bundledDir, destRoot);
    return destRoot;
  } catch (error) {
    console.warn("seed ponytail plugin cache failed:", error);
    return null;
  }
}

const MARKETPLACE_SECTION = (source: string) => [
  "[marketplaces.ponytail]",
  `source_type = "local"`,
  `source = "${source.replaceAll("\\", "/")}"`,
  "",
  `[plugins."ponytail@ponytail"]`,
  "enabled = true",
  "",
  `[hooks.state."ponytail@ponytail:hooks/claude-codex-hooks.json:session_start:0:0"]`,
  `trusted_hash = "${PONYTAIL_HOOK_TRUSTED_HASH}"`,
  "",
].join("\n");

/**
 * 注册段种进 config.toml：缺 [marketplaces.ponytail] 才 append 一段。
 * 这些段不在 HARNESS_CONFIG_SECTIONS，harness 后续整份重写时会被 preserveUserConfig
 * 原样拼回，不会重复；这里只在「从未出现过」时写一次。
 */
async function seedConfigSections(codexHome: string, bundledDir: string): Promise<void> {
  const configPath = path.join(codexHome, "config.toml");
  try {
    let existing = await fs.readFile(configPath, "utf8").catch(() => "");
    if (/\[marketplaces\.ponytail\]/.test(existing)) return; // 已有注册段则幂等跳过
    if (!fsSync.existsSync(bundledDir)) return;
    const append = MARKETPLACE_SECTION(bundledDir);
    const next = existing.trim() ? existing.trimEnd() + "\n\n" + append + "\n" : append + "\n";
    await fs.writeFile(configPath, next, "utf8");
    console.log("ponytail marketplace sections seeded into config.toml");
  } catch (error) {
    console.warn("seed ponytail config sections failed:", error);
  }
}

/**
 * 首启种子入口（app.whenReady 里、引擎启动前调用）：
 * 内置目录 → 插件 cache + config 注册段。两件事独立失败互不影响。
 *
 * 注意：**不**把插件 skills/ 拷到全局 codexHome/skills/——引擎 skills/list 会直接从
 * 插件 cache 列出技能（实测 cache 就位即出现 6 个 ponytail-*，plugin 标记正确）；
 * 额外种全局只会让技能列表重复（每个 ponytail-* 出现两遍，像假的）。
 */
export async function ensurePonytailPlugin(codexHome: string, bundledDir: string, version: string = PONYTAIL_VERSION): Promise<void> {
  if (!bundledDir || !fsSync.existsSync(bundledDir)) {
    // dev 未放置内置目录时静默跳过（不阻塞启动），生产包必有
    return;
  }
  // ⛔ version 参数：在线更新下载来的新标签版本不等于随包的 PONYTAIL_VERSION，
  //    必须按实际版本建目录 —— 落错目录名引擎就当没装（同样的目录存在过一个，但版本对不上）。
  await seedPluginCache(bundledDir, codexHome, version);
  await seedConfigSections(codexHome, bundledDir);
}
