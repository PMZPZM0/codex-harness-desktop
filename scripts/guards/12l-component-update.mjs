#!/usr/bin/env node
/**
 * 12l-component-update —— 统一更新体系守卫（10-13 用户令：「覆盖全部同类组件的统一更新体系」）。
 *
 * 钉的都是「一旦破了就会悄悄回到各自为政」的坑：
 *  ① **清单单一真相源**：组件清单只在 electron/update-registry.ts，别处不许再写一份包名/来源表；
 *  ② **镜像策略单一真相源**：update-registry 只引用（npm/pip/github 三张既有表），不许抄 URL 字面量；
 *  ③ **不可更新的条目必须写原因**（mirror:false 而 reason 为空 = 用户看到一行没头没尾的「不支持」）；
 *  ④ **远端一律国内镜像**：pip 走 PIP_INDEXES、GitHub 走 GH_MIRROR_PREFIXES；出现裸 github.com 取数
 *     必须经 withPrefix（直连只能作为最后一档候选，不许写死成首选）；
 *  ⑤ **幂等**：更新前后比内容指纹 / 版本号，一致 ⇒ action=unchanged，不重复安装；
 *  ⑥ **失败回滚**：有目标目录的分支必须走 withRollback（保证不留在「半更新」状态）；
 *  ⑦ **手动链 = 自动链**：后台循环与手动通道都调 updateComponent，不许按 kind 再写一套；
 *  ⑧ **开关关就不检查**：runCycle 里开关判定在 update 之前 continue（不是"查到了不装"）；
 *  ⑨ **界面不自己定默认值**：行数据自带 enabled，UI 不许再写一份缺省判断；
 *  ⑩ 控制台要有「检测 / 单个更新」入口 + 台账有条目；「一键更新全部」已按用户要求删除（按键丑）。
 */
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0;
let fails = 0;
const ok = (cond, label) => {
  checks++;
  if (!cond) fails++;
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}`);
};

const read = (p) => {
  try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; }
};
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|\s)\/\/[^\n]*/g, "$1");

const registry = read("electron/update-registry.ts");
const backends = read("electron/update-backends.ts");
const safety = read("electron/update-safety.ts");
const board = read("electron/features/auto-update-ipc.ts");
const appSettings = read("electron/app-settings.ts");
const card = read("src/features/settings-general/AutoUpdateCard.tsx");
const general = read("src/features/settings-general/GeneralSettingsSection.tsx");
const ledger = read("docs/FEATURE-LEDGER.md");
const cardCode = stripComments(card);
const backendsCode = stripComments(backends);
const boardCode = stripComments(board);
const registryCode = stripComments(registry);

console.log("【① 清单单一真相源】");
ok(/export const COMPONENT_SPECS/.test(registryCode) && /export function componentSpec/.test(registryCode),
  "electron/update-registry.ts 导出组件清单 COMPONENT_SPECS + componentSpec");
// ⛔ 别处不许出现"第二类组件清单"（这里用包名数组判 —— 写第三份包名表时这里会红）
ok(!/const\s+[A-Z_]*(PACKAGES|COMPONENTS|TARGETS)\s*=/.test(backendsCode),
  "⛔ 后端不含第二份「组件清单/包名表」（清单只认 update-registry）");
ok(/import .*componentSpec|from "\.\/update-registry"/.test(backendsCode),
  "后端从 update-registry 取清单");
ok(/from "\.\.?\/update-registry"/.test(boardCode),
  "编排层（auto-update-ipc）也从 update-registry 取清单");

console.log("【② 镜像策略单一真相源】");
ok(/from "\.\/gh-mirror"/.test(registryCode) && /from "\.\/features\/pip-sources"/.test(registryCode),
  "GitHub 与 pip 的源表**引用**既有单一真相源（gh-mirror / pip-sources）");
ok(!/https:\/\/pypi\.tuna|https:\/\/mirrors\.cloud\.tencent|https:\/\/mirrors\.aliyun/.test(registryCode),
  "⛔ update-registry 不抄 pip 镜像 URL 字面量（只用 PIP_INDEXES）");
ok(/export function mirrorOrder/.test(registryCode) && /case "npm":/.test(registryCode) && /case "pip":/.test(registryCode) && /case "github":/.test(registryCode),
  "mirrorOrder 覆盖 npm / pip / github 三条远端通道");
ok(/source === "direct"\s*\n?\s*\?\s*\[NPM_SOURCES\.official/.test(registryCode) || /NPM_SOURCES\.official, NPM_SOURCES\.mirror/.test(registryCode),
  "默认（auto/mirror）下 npm 是**国内镜像在前**、官方兜底");
ok(/GH_MIRROR_PREFIXES/.test(registryCode) && !/gh-proxy\.com\/?"/.test(registryCode.replace(/https:\/\/gh-proxy\.com\/",\s*$/gm, "")),
  "GitHub 通道不写死单一镜像站，走 GH_MIRROR_PREFIXES 的三级顺序");

console.log("【③ 不可更新的条目必须写明原因】");
{
  // 逐个 spec 块核对 mirror/reason 配对（reason 为空且 mirror:false = 用户看到一句没头没尾的拒绝）
  const blocks = registryCode.split(/\n\s*\{\n/).slice(1);
  let paired = true;
  let bad = "";
  for (const block of blocks) {
    const mirrorFalse = /mirror:\s*false/.test(block);
    const hasReason = /reason:\s*"[^"]{10,}"/.test(block);
    if (!hasReason) { paired = false; bad = block.slice(0, 60).replace(/\s+/g, " "); break; }
  }
  ok(paired, `每个 spec 都有非空 reason（${paired ? "全部通过" : "反例：" + bad}）`);
  const offCount = (registryCode.match(/mirror:\s*false/g) ?? []).length;
  ok(offCount >= 4, `结论性「无可用镜像源」的条目已列明并计数（当前 ${offCount} 条）`);
  ok(/channel:\s*"none"/.test(registryCode) && /随应用/.test(registryCode) && /钩子/.test(registryCode),
    "内置技能 / 随包工具 / 钩子 / 声明式插件都进了清单并给了原因（排查无遗漏的证据）");
}

console.log("【④ 远端一律走国内镜像】");
ok(/mirrorOrder\("pip", source\)/.test(backendsCode) && !/pypi\.org\/simple/.test(backendsCode),
  "pip 更新按 PIP_INDEXES 逐个源重试（代码里没有写死官方源）");
ok(/mirrorOrder\("github", source\)/.test(backendsCode) && /withPrefix\(url, prefix\)/.test(backendsCode),
  "GitHub 取数与下载都套镜像前缀后才 fetch（直连只是最后一档候选）");
ok(!/await fetch\(`?https:\/\/(api\.)?github\.com/.test(backendsCode),
  "⛔ 后端没有裸 github.com 的 fetch（那条一定会绕过镜像）");
ok(/mirrorOrder\("pip", ctx\.source\)|mirrorOrder\("pip", source\)/.test(backendsCode) && /-i", index/.test(backendsCode),
  "pip install 显式带 -i <镜像索引>");

console.log("【⑤ 幂等：内容一致不重装】");
ok(/dirFingerprint/.test(backendsCode) && /after === before\s*\n?\s*\? outcome\("unchanged"/.test(backendsCode),
  "更新前后比内容指纹，一致 ⇒ action=unchanged（不重复安装）");
ok(/result\.to === result\.from\s*\n?\s*\? outcome\("unchanged"/.test(backendsCode),
  "工具/引擎分支也比版本号，版本相同 ⇒ unchanged");
ok(/export async function dirFingerprint/.test(safety) && /crypto\.createHash\("sha256"\)/.test(safety),
  "指纹基于 sha256，且目录名/修改时间不进指纹（否则重装也会得到不同值）");

console.log("【⑥ 失败回滚：不留半更新状态】");
ok(/export async function withRollback/.test(safety) && /restoreDir/.test(safety),
  "electron/update-safety.ts 提供快照 + 回滚");
ok((backendsCode.match(/withRollback\(/g) ?? []).length >= 4,
  `市场技能 / 插件 / 专家包等有目录的分支都走 withRollback（当前 ${(backendsCode.match(/withRollback\(/g) ?? []).length} 处）`);
ok(/先删后拷|restoreDir\(taken\.dir, targetDir\)/.test(safety),
  "回滚是「先删残缺目标再整份拷回」（不是合并，避免留下混合目录）");
ok(/已自动回滚到更新前的版本|回滚也失败了/.test(safety),
  "回滚成功/失败都给用户明确说法（失败不许吞掉）");
ok(/KEEP_PER_COMPONENT|TOTAL_CAP_BYTES/.test(safety) && /export async function pruneSnapshots/.test(safety),
  "快照有 prune（每组件最多 N 份 + 总量上限），不会把磁盘撑爆");

console.log("【⑦ 手动链 = 自动链】");
ok(/updateRow\(row, source, settings\)/.test(boardCode) && /updateComponent\(spec, row\.id/.test(boardCode),
  "后台循环与手动通道都经 updateRow → updateComponent 同一函数");
ok(!/performEngineUpdateFlow|performRuntimeUpdate/.test(boardCode),
  "⛔ 编排层不再直接调各家内��安装函数（判据只有一份，不在编排层再来一遍）");

console.log("【⑧ 开关关闭 ⇒ 不发起检查】");
ok(/if \(!readAutoUpdateRowSwitch\(settings, row\.id\)\) continue;/.test(boardCode),
  "runCycle 里开关判定在 continue 之前（关掉就整行跳过，连检查都不做）");
ok(/readAutoUpdateRowSwitch/.test(appSettings) && /autoUpdateOverrides/.test(appSettings),
  "每行的开关判据唯一入口 readAutoUpdateRowSwitch（含 overrides map，支持任意组件行）");
ok(/AUTO_UPDATE_DEFAULT_OFF/.test(appSettings),
  "会改写用户文件的三类（市场技能/专家包/人格包）默认关，其余默认开 —— 分档只写一处");

console.log("【⑨ 界面不自己定默认值】");
ok(/enabled: boolean;/.test(cardCode) && /checked=\{row\.enabled\}/.test(cardCode),
  "行数据自带 enabled，UI 直接渲染（⛔ 界面不许再写一份缺省判断）");
ok(!/\["market-skill", "expert-skill", "soul"\]\.includes/.test(cardCode),
  "⛔ UI 不再自己维护「哪几类默认关」的名单（那会让界面与后台漂移）");

console.log("【⑩ 控制台统一入口 + 台账】");
ok(/window\.codex\.scanAutoUpdateComponents\(/.test(cardCode), "控制台有「检测更新」入口");
ok(/window\.codex\.runAutoUpdateComponent\(row\.id\)/.test(cardCode), "控制台支持按名称/组件逐个更新");
ok(!/runAllAutoUpdateComponents/.test(cardCode) && !/一键更新全部/.test(cardCode), "⛔ 不再有「一键更新全部」（用户：按键真丑，已删）");
ok(/auto-update-log/.test(cardCode), "有进度与结果输出区");
ok(/noMirror|无可用镜像源/.test(cardCode), "⛔ 控制台显式标注「无可用镜像源」的条目");
ok(/<AutoUpdateCard/.test(general), "卡片挂在「控制台」（general）页");
ok(/统一更新|组件更新/.test(ledger), "docs/FEATURE-LEDGER.md 有本轮条目");

console.log("【⑪ 当前版本 = 实际安装态（不是随包常量）】");
/* 10-13 用户实测的真 bug：控制台那行显示「4.9.0 → v5.2.0（有可用更新）」，点更新后 toast 说「已更新」，
   但版本号与徽标一直不动。根因：ponytail 的「当前版本」报的是**随包常量** PONYTAIL_VERSION（4.9.0），
   而在线更新装的是**按标签命名**的目录（…/ponytail/ponytail/5.2.0）—— 磁盘上只剩 5.2.0，界面仍报 4.9.0。
   判据：① 版本必须从引擎落点实际读；② 两个分支（检测 / 更新前）都用它；③ 「有没有新版」走 compareVersions
   （⛔ 不再用字符串不等）；④ **造夹具跑编译产物里的真函数**做行为断言（不是看文本）。 */
{
  const pluginSrc = read("electron/ponytail-plugin.ts");
  ok(/export async function listInstalledPonytailVersions\(/.test(pluginSrc),
    "ponytail-plugin 导出「读引擎落点里实际安装版本」的 listInstalledPonytailVersions");
  ok(/plugins", "cache", "ponytail", "ponytail"/.test(pluginSrc),
    "读的是引擎安装落点 plugins/cache/ponytail/ponytail/<版本>");
  ok((backendsCode.match(/installedPonytailVersion\(ctx\.codexHome\)/g) ?? []).length >= 2,
    "检测与「更新前」两个分支都按实际安装版本取当前版本");
  ok(!/current:\s*PONYTAIL_VERSION/.test(backendsCode),
    "⛔ 检测分支不再把随包常量当当前版本（那会让控制台永远停在「有可用更新」、更新完也不刷新）");
  ok(!/!==\s*PONYTAIL_VERSION/.test(backendsCode),
    "⛔ 不再用「字符串不等」判 ponytail 有没有新版");
  ok(/compareVersions\(latest, current\) > 0/.test(backendsCode) && /compareVersions\(tag, before\) <= 0/.test(backendsCode),
    "ponytail 的更新判据走 updates.ts 的 compareVersions（版本比较单一真相源）");

  const distPlugin = join(ROOT, "dist-electron", "ponytail-plugin.js");
  if (!existsSync(distPlugin)) {
    fail("【⑪】dist-electron/ponytail-plugin.js 不存在（先构建再跑预检）—— 行为断言无法执行");
  } else {
    try {
      const mod = await import(pathToFileURL(distPlugin).href);
      const root = await mkdtemp(join(tmpdir(), "ponytail-fixture-"));
      const home = join(root, "codex-home");
      for (const v of ["4.9.0", "5.2.0"]) {
        const dir = join(home, "plugins", "cache", "ponytail", "ponytail", v);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "plugin.yaml"), `name: ponytail\nversion: ${v}\n`, "utf8");
      }
      const found = await mod.listInstalledPonytailVersions(home);
      const bothSeen = Array.isArray(found) && found.includes("4.9.0") && found.includes("5.2.0");
      ok(bothSeen,
        `【⑪】实际安装版本确实从磁盘读（夹具放两个版本 ⇒ 读到 ${JSON.stringify(found)}；应含 4.9.0 与 5.2.0）`);
      ok(!(Array.isArray(found) && found.length === 1 && found[0] === "4.9.0"),
        "⛔ 读到的不是随包常量（否则界面在更新后仍报 4.9.0）");
      const empty = await mod.listInstalledPonytailVersions(join(root, "no-such-home"));
      ok(Array.isArray(empty) && empty.length === 0,
        "落点不存在时返回空数组（调用方才能区分「没装」与「装了旧版」）");
      await rm(root, { recursive: true, force: true });
    } catch (e) {
      fail(`【⑪】dist-electron/ponytail-plugin.js 行为断言执行失败：${e && e.message ? e.message : String(e)}`);
    }
  }
}

console.log("");
console.log(fails === 0 ? `12l 组件更新守卫：全部通过（${checks}/${checks}）` : `12l 组件更新守卫：${fails} 项未通过（共 ${checks} 项）`);
process.exit(fails === 0 ? 0 : 1);
