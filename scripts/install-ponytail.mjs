/**
 * 把已安装的 ponytail 插件里的 6 个技能复制进 Codex 本地技能目录，
 * 让它们出现在 Harness 的「技能中心 → 已安装管理」里（可启用/停用、卸载）。
 * 幂等：重复执行只做覆盖，不会重复登记。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const home = process.env.CODEX_HARNESS_HOME
  || path.join(os.homedir(), "AppData", "Roaming", "Codex Harness Desktop");
const codexHome = path.join(home, "codex-home");
const pluginRoot = path.join(codexHome, "plugins", "cache", "ponytail", "ponytail");
const userSkillsDir = path.join(codexHome, "skills");
const registryFile = path.join(codexHome, "skills-registry.json");
// 技能与插件的归属关系写在技能目录里的 .plugin.json，
// 钩子页的联动开关靠它找到「这个插件提供了哪些技能」。
const PLUGIN_ID = "ponytail@ponytail";

if (!fs.existsSync(pluginRoot)) {
  console.error(`未找到已安装的 ponytail 插件：${pluginRoot}\n请先执行：codex plugin add ponytail@ponytail`);
  process.exit(1);
}

// 取版本号最大的那份缓存
const version = fs.readdirSync(pluginRoot).sort().pop();
const skillsRoot = path.join(pluginRoot, version, "skills");
if (!fs.existsSync(skillsRoot)) {
  console.error(`插件缓存里没有 skills 目录：${skillsRoot}`);
  process.exit(1);
}

fs.mkdirSync(userSkillsDir, { recursive: true });
let registry = [];
try { registry = JSON.parse(fs.readFileSync(registryFile, "utf8")); } catch { registry = []; }
if (!Array.isArray(registry)) registry = [];

const installed = [];
for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const sourceFile = path.join(skillsRoot, entry.name, "SKILL.md");
  if (!fs.existsSync(sourceFile)) continue;
  const content = fs.readFileSync(sourceFile, "utf8");
  const declaredName = content.match(/^name:\s*["']?(.+?)["']?\s*$/mi)?.[1]?.trim();
  const folder = declaredName || entry.name;
  const destination = path.join(userSkillsDir, folder);
  fs.mkdirSync(destination, { recursive: true });
  // 停用态是 SKILL.md.disabled；安装/重装时统一回到启用态
  const disabledFile = path.join(destination, "SKILL.md.disabled");
  if (fs.existsSync(disabledFile)) fs.rmSync(disabledFile, { force: true });
  fs.writeFileSync(path.join(destination, "SKILL.md"), content);
  fs.writeFileSync(path.join(destination, ".plugin.json"), `${JSON.stringify({ pluginId: PLUGIN_ID, sourceUrl: "https://github.com/DietrichGebert/ponytail" }, null, 2)}\n`, "utf8");
  const record = { name: folder, path: path.join(destination, "SKILL.md"), source: "local", sourceUrl: "https://github.com/DietrichGebert/ponytail", installedAt: new Date().toISOString() };
  registry = registry.filter((item) => item?.path !== record.path);
  registry.push(record);
  installed.push(folder);
}

fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2), "utf8");
console.log(`已安装 ${installed.length} 个 ponytail 技能到 ${userSkillsDir}`);
console.log(installed.map((name) => `  - ${name}`).join("\n"));
console.log("\n重启 Harness 后可在「设置 → 技能 → 已安装管理」中启用/停用。");
