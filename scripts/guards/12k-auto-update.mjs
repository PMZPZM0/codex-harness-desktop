#!/usr/bin/env node
/**
 * 12k-auto-update —— 自动化与引擎的后台自动更新（10-13 用户令）守卫。
 *
 * 钉的都是「真会复发的坑」：
 *  ① 四类（桌面 / 浏览器 / Mac 电脑操作 / 引擎）**开关互相独立**：四个 AppSettings 字段、
 *     缺省即开（`!== false`）、`autoUpdate:set` 只 patch 单键；
 *  ② **手动链 = 自动链同一函数**（runtime-ipc / engine-ipc 导出，两边都调）——
 *     两处各写判据必漂移（技能更新已栽过一次）；
 *  ③ **更新源不另抄**：auto-update-ipc 里不许出现任何镜像 URL 字面量（沿用各链路既有国内镜像优先）；
 *  ④ Mac 电脑操作**按平台过滤**（非 darwin 不入清单），且包名只在 UPDATEABLE_TOOLS 里写一次；
 *  ⑤ 后台三道闸：防重入 / 单类失败只跳过 / finally 放闸 + ctx.effect 清定时器；
 *  ⑥ 更新成功要发通知；引擎更新成功后必须把引擎拉回来（否则应用等于残废）；
 *  ⑦ 界面：自动化卡片有 ToggleSwitch + 版本号；
 *  ⑧ 域登记闭环（composition / ipc-registry / manifest / preload）+ FEATURE-LEDGER 有条目。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
/** 剥掉注释再判「有没有写字面量」——⛔ 文档里**提到** npmmirror / 包名是应该的，
 *  判据只该管**代码**（把注释算成第二份真相源 ⇒ 逼人删掉有用的说明，守卫反而害事）。 */
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|\s)\/\/[^\n]*/g, "$1");

/** 按锚点切片取某个 JSON 条目（⛔ 别用惰性正则切 JSON —— 没锚点会切到空串报假红，12j 教训） */
const sliceEntry = (text, anchor) => {
  const at = text.indexOf(anchor);
  if (at < 0) return "";
  const start = text.lastIndexOf("{", at);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return "";
};

const board = read("electron/features/auto-update-ipc.ts");
const backends = read("electron/update-backends.ts");
const backendsCode = stripComments(backends);
const runtimeIpc = read("electron/features/runtime-ipc.ts");
const engineIpc = read("electron/features/engine-ipc.ts");
const settings = read("electron/app-settings.ts");
const manifest = read("electron/ipc-channels.manifest.json");
const preload = read("electron/preload.ts");
const registry = read("electron/ipc-registry.ts");
const composition = read("electron/composition.json");
const page = read("src/features/settings-automation/AutomationSettingsSection.tsx");
const ledger = read("docs/FEATURE-LEDGER.md");
const boardCode = stripComments(board);

console.log("【① 四个开关互相独立 + 缺省即开】");
for (const key of ["autoUpdateDesktop", "autoUpdateBrowser", "autoUpdateComputerUse", "autoUpdateEngine"]) {
  ok(settings.includes(`${key}?: boolean`), `AppSettings 有独立字段 ${key}`);
}
ok(/function autoUpdateEnabled[\s\S]{0,400}\?\.\[key\] !== false/.test(settings),
  "缺省判据是 `!== false`（字段不存在 = 开；⛔ 用 === true 会让老用户升级后静默关闭）");
ok(/readAutoUpdateRowSwitch\(settings, row\.id\)/.test(board),
  "后台循环逐行读自己的开关（10-13 统一体系后：行白可由 readAutoUpdateRowSwitch 一处裁决）");
ok(/saveAppSettings\(userData, \{ \[owner\]: Boolean\(enabled\) \}/.test(board),
  "⛔ autoUpdate:set 只 patch 单键（写整份会互相覆盖 ⇒ 开关不独立）");
const keysBlock = board.match(/const toolKeys[\s\S]*?\};/)?.[0] ?? "";
ok(/nuphus: "autoUpdateDesktop"/.test(keysBlock) && /"playwright-cli": "autoUpdateBrowser"/.test(keysBlock)
  && /"computer-use": "autoUpdateComputerUse"/.test(keysBlock),
  "三类工具各自映射到自己的开关字段（不是共用一把总闸）");

console.log("【② 手动链 = 自动链（单一真相源）】");
ok(/export async function checkRuntimeUpdateRow/.test(runtimeIpc) && /export async function performRuntimeUpdate/.test(runtimeIpc),
  "runtime-ipc 导出 checkRuntimeUpdateRow / performRuntimeUpdate");
ok(/ipcHost\.handle\("runtime:update-check"[\s\S]{0,300}checkRuntimeUpdateRow/.test(runtimeIpc)
  && /ipcHost\.handle\("runtime:update"[\s\S]{0,200}performRuntimeUpdate/.test(runtimeIpc),
  "界面「检查更新 / 更新」按钮只是这两个函数的薄包装");
// ⛔ 10-13 统一体系后，编排层不再直接调各家函数，而是经 update-backends 的 updateComponent；
//    统一后的判据在 backends 里，**仍然必须是同一批导出函数**（换位置可以，抄第二份不行）。
ok(/import \{ checkRuntimeUpdateRow, performRuntimeUpdate/.test(backendsCode)
  && /performRuntimeUpdate\(spec\.id\)/.test(backendsCode),
  "执行层调的是 runtime-ipc 导出的同一批函数（⛔ 不许在别处再抄一遍判据）");
ok(/export async function checkEngineUpdateInfo/.test(engineIpc) && /export async function performEngineUpdateFlow/.test(engineIpc),
  "engine-ipc 导出 checkEngineUpdateInfo / performEngineUpdateFlow");
ok(/ipcHost\.handle\("engine:check-update", \(\) => checkEngineUpdateInfo\(\)\)/.test(engineIpc),
  "engine:check-update 走同一实现");
ok(/performEngineUpdateFlow\(/.test(engineIpc) && /performEngineUpdateFlow\(async \(\) =>/.test(backendsCode),
  "引擎手动与后台都走 performEngineUpdateFlow（唯一接缝 = 成功后怎么办）");

console.log("【③ 更新源不另抄（统一国内镜像）】");
ok(!/https?:\/\//.test(boardCode),
  "⛔ auto-update-ipc 代码里不含任何镜像 URL 字面量（源沿用两条链路既有的国内镜像优先）");
ok(/CHINA_NPM_REGISTRY/.test(runtimeIpc) && /NPMMIRROR/.test(read("electron/engine-updater.ts")),
  "两条链路各自持有国内镜像常量（删掉就等于源被换回官方）");

console.log("【④ Mac 电脑操作：按平台过滤 + 包名只写一次】");
ok(/"computer-use": \{[^}]*open-computer-use[^}]*platforms: \["darwin"\]/.test(runtimeIpc),
  "UPDATEABLE_TOOLS 里 computer-use 带 platforms:[darwin]");
ok(/export function updateableToolIds\(\)[\s\S]{0,300}platforms\.includes\(process\.platform\)/.test(runtimeIpc),
  "updateableToolIds() 按平台过滤（非 mac 根本不入清单）");
ok(/const ids = idValue \? \[idValue\] : updateableToolIds\(\)/.test(runtimeIpc),
  "runtime:update-check 用 updateableToolIds()，不是 Object.keys(UPDATEABLE_TOOLS)");
// @openai/codex 是**引擎**的包名，不在 UPDATEABLE_TOOLS 里（引擎不走 npm install），写一次是合理的；
// 三类工具的包名则必须全部来自 updateableToolMeta —— 抄第二份就会和 UPDATEABLE_TOOLS 对不上。
ok(/updateableToolMeta/.test(boardCode)
  && !/@nuphus\/nuphus-mcp|@playwright\/cli|open-computer-use/.test(boardCode),
  "⛔ 三类工具的包名只写在 UPDATEABLE_TOOLS（板块经 updateableToolMeta 取，不抄第二份）");

console.log("【⑤ 后台三道闸】");
ok(/if \(running\) return;[\s\S]{0,80}running = true;/.test(board), "闸 1 防重入（上轮没跑完不开新一轮）");
ok(/for \(const row of rows\)[\s\S]{0,900}console\.warn/.test(board),
  "闸 2 单类失败只 warn 跳过、继续跑其余（一个包挂了不拖垮全部）");
ok(/finally \{[\s\S]{0,120}running = false;/.test(board), "闸 3 finally 放闸");
ok(/clearInterval\(timer\)/.test(board) && /clearTimeout\(first\)/.test(board) && /ctx\.effect\(/.test(board),
  "定时器在 ctx.effect 里摘除（不留泄漏）");

console.log("【⑥ 通知 + 引擎必须拉回来】");
ok(/new Notification\(\{/.test(board) && /notifyUpdated\(/.test(board), "更新成功发系统通知");
ok(/Notification\.isSupported\(\)/.test(board), "通知在不支持的环境静默跳过（后台任务不许因通知失败而失败）");
const engineSuccess = backendsCode.match(/performEngineUpdateFlow\(async \(\) =>[\s\S]{0,400}?\n {8}\}\)/)?.[0] ?? "";
ok(/server\.restart\(\)/.test(engineSuccess),
  "⛔ 引擎更新成功后必须 server.restart() 把引擎拉回来（更新流程会先 stop 掉引擎，不拉 = 应用残废）");

console.log("【⑦ 界面：开关统一在控制台 + 版本号】");
const card = read("src/features/settings-general/AutoUpdateCard.tsx");
const general = read("src/features/settings-general/GeneralSettingsSection.tsx");
const skillsPage = read("src/features/settings-skills/SkillsCenterSection.tsx");
ok(/<AutoUpdateCard[^>]*\/>/.test(general) && /from "\.\/AutoUpdateCard"/.test(general),
  "「控制台」页挂上了统一开关卡片");
ok(/ToggleSwitch/.test(card) && /window\.codex\.setAutoUpdate\(row\.id, enabled\)/.test(card)
  && /window\.codex\.readAutoUpdateStatus\(\)/.test(card),
  "卡片用共享 ToggleSwitch，读 autoUpdate:status、写 autoUpdate:set（⛔ 原生 checkbox 暗色下画成浅底）");
ok(!/ToggleSwitch/.test(page) && !/skillAutoUpdate/.test(skillsPage),
  "⛔ 自动化页与技能页**不再各放一个开关**（同一状态两个入口 ⇒ 用户会以为两边不一致）");
ok(/控制台/.test(read("src/features/settings-automation/AutomationSettingsSection.tsx"))
  && /控制台/.test(skillsPage),
  "两处都留了指向「控制台」的说明（不是静默消失）");
ok(/versionOf\("nuphus"\)/.test(page) && /versionOf\("playwright-cli"\)/.test(page),
  "桌面自动化 / 浏览器自动化卡片显示当前版本号");
ok(!/Object\.keys\(UPDATEABLE_TOOLS\)|nuphus.*@nuphus/.test(page) && !/@nuphus|@playwright/.test(card),
  "⛔ 界面不另抄工具清单与包名");

console.log("【⑦b 技能那条：一个端点给全部开关】");
ok(/"market-skill": "skillAutoUpdate"/.test(settings) && /skill: "skillAutoUpdate"/.test(settings),
  "市场技能行归属技能内容开关（界面一次请求仍能拿全开关）");
ok(/if \(row\.specId === "market-skill"\) continue;/.test(boardCode),
  "⛔ 技能的后台循环仍在 skills-ipc（本板块只承载开关与显示），不重复起调度器");
ok(/if \(!readAutoUpdateRowSwitch\(settings, row\.id\)\) continue;[\s\S]{0,200}await updateRow\(row/.test(boardCode),
  "⛔ 关掉就不**发起检查**：开关判定在「更新」之前 continue 掉（连比对都不做）");
ok(/autoUpdateRunning\) return;/.test(read("electron/features/skills-ipc.ts"))
  && /if \(!enabled\) return;[\s\S]{0,120}checkSkillUpdateRows\(\)/.test(read("electron/features/skills-ipc.ts")),
  "⛔ 技能同理：关着时在 checkSkillUpdateRows 之前返回（连内容比对都不做）");

console.log("【⑦c 每行有名称 / 说明 / tooltip / 状态反馈】");
ok(/<strong>\{row\.label\}<\/strong>/.test(card) && /<small>\{(describeComponent\(row\)|text)\}<\/small>/.test(card),
  "每行 = 名称 + 简要说明");
ok(/title=\{row\.enabled \? `关闭/.test(card), "每行有 tooltip（说明开/关会做什么）");
ok(/不会发起更新检查/.test(card), "关闭态明确写出「不会发起更新检查」（开关的语义，不是装饰）");
ok(/onNotice\?\.\(applied \?/.test(card) && /onNotice=\{setNotice\}/.test(general),
  "写盘成功后有状态反馈（对齐控制台既有的 notice 用法）");
ok(/readAutoUpdateSwitch/.test(settings) && /skillAutoUpdate === true/.test(settings),
  "缺省值分档只写一处：四类装包缺省开、技能内容更新缺省关");

console.log("【⑧ 域登记闭环 + 台账】");
ok(/"id": "autoUpdate"/.test(composition) && /features\/auto-update-ipc\.ts/.test(composition) && /autoUpdateFeature/.test(composition),
  "composition.json 登记 autoUpdate 域");
ok(/prefix: "autoUpdate", count: 5/.test(registry), "ipc-registry 记账 autoUpdate(5)");
ok(/autoUpdate:status/.test(manifest) && /autoUpdate:set/.test(manifest), "manifest 有两条通道");
ok(/readAutoUpdateStatus/.test(preload) && /setAutoUpdate/.test(preload), "preload 暴露两个方法");
ok(/自动更新/.test(ledger) && /autoUpdate/.test(ledger), "FEATURE-LEDGER 有对应条目");

console.log(fails ? `\n✗ 12k 未通过：${fails}/${checks}` : `\n✓ 12k 通过：${checks}/${checks}`);
process.exit(fails ? 1 : 0);
