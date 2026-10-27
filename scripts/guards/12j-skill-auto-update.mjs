#!/usr/bin/env node
/**
 * 12j-skill-auto-update —— 技能 / 插件自动更新与更新入口收口（10-13 立，10-24 扩插件）。
 *
 * 用户 10-24：「已安装插件为啥两张展示方式」「精简成一个技能更新开关，和插件更新开关就行，
 * 但是更新都要更新那个插件和技能」。
 *
 * 钉的坑：
 *  ① 插件页不再有「插件更新 / 官方插件更新」两块面板（它们和下方已安装列表重复）；
 *     手动入口收成一个「检查更新」按钮，两个市场都查、有新版逐个更新。
 *  ② 控制台只留「技能自动更新 / 插件自动更新」两个总开关；逐技能/逐插件行不再透出。
 *  ③ 两个开关都必须**真的跑更新**：技能走 skills-ipc 的后台循环，插件走 plugins-ipc 的
 *     后台循环（两个市场、有新版才重装、单插件失败跳过、定时器随 feature 释放）。
 *  ④ 开关判据唯一来源在 app-settings（pluginAutoUpdate 默认关），⛔ 别在别处另写默认值。
 */
import { existsSync, readFileSync } from "node:fs";
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

console.log("【① 插件页只留一份更新入口】");
const pluginsPage = read("src/features/settings-plugins/PluginsMarketSection.tsx");
ok(pluginsPage.length > 0, "插件页文件在位");
ok(!/MarketUpdatePanel|market-updates/.test(pluginsPage), "⛔ 插件页不再引用两块市场更新面板");
/* 10-27 用户令：「检查更新不要了，因为控制台有自动技能更新，卡片里这一行留一个刷新图标就行」
   ⇒ 已安装屏不再挂手动「检查更新」按钮；更新能力本身留着（自动更新链仍在跑）。 */
ok(!/plugin-update-all/.test(pluginsPage) && /checkAndUpdatePlugins/.test(pluginsPage), "已安装屏不再挂手动「检查更新」（自动更新链保留）");
ok(/checkPluginUpdates\(\)/.test(pluginsPage) && /checkOfficialPluginUpdates\(\)/.test(pluginsPage), "检查更新同时查 Gitee 镜像与 Codex 官方两个市场");
ok(/updatePlugin\(row\.slug\)/.test(pluginsPage) && /updateOfficialPlugin\(row\.slug\)/.test(pluginsPage), "有新版时按来源逐个更新（走与安装同一链路）");
ok(!existsSync(join(ROOT, "src/features/market-updates/MarketUpdatePanel.tsx")), "⛔ 旧的 MarketUpdatePanel 已删除（不留死组件）");
const skillsPage = read("src/features/settings-skills/SkillsCenterSection.tsx");
ok(!/MarketUpdatePanel|plugin-update-all/.test(skillsPage), "技能页没有重复的更新面板/按钮（更新走控制台总开关）");

console.log("【② 控制台只剩两个总开关，逐项行已收起】");
const card = read("src/features/settings-general/AutoUpdateCard.tsx");
ok(/技能自动更新/.test(card) && /插件自动更新/.test(card), "控制台有「技能自动更新 / 插件自动更新」两个总开关");
ok(/primarySwitches/.test(card) && /row\.kind === "skill" \|\| row\.kind === "plugin"/.test(card), "两个总开关优先渲染");
ok(/\["工具", "引擎", "不可单独更新"\]/.test(card) && !/\["工具", "引擎", "技能", "插件"/.test(card), "⛔ 组件清单不再透出「技能」「插件」逐项行");
ok(/setAutoUpdate\(row\.id, enabled\)/.test(card), "开关仍走统一 setAutoUpdate（失败回滚）");
ok(/checked=\{row\.enabled\}/.test(card), "开关复用共享 ToggleSwitch");

console.log("【③ 插件自动更新真的跑】");
const settings = read("electron/app-settings.ts");
ok(/pluginAutoUpdate\?: boolean/.test(settings), "AppSettings 有 pluginAutoUpdate（默认 undefined = 关）");
ok(/pluginAutoUpdate/.test(settings) && /"market-plugin": "pluginAutoUpdate"/.test(settings) && /"official-plugin": "pluginAutoUpdate"/.test(settings), "市场插件/官方插件行归属同一把开关");
ok(/key === "skillAutoUpdate" \|\| key === "pluginAutoUpdate"/.test(settings), "两个总开关缺省都按「显式开启」判定");
const autoIpc = read("electron/features/auto-update-ipc.ts");
ok(/id: "plugin", kind: "plugin", label: "市场插件自动更新"/.test(autoIpc), "autoUpdate:status 清单含插件总开关");
ok(/type AutoUpdateKind = "tool" \| "engine" \| "skill" \| "plugin"/.test(autoIpc), "插件是合法更新类型");
const pluginsIpc = read("electron/features/plugins-ipc.ts");
ok(/runPluginAutoUpdate/.test(pluginsIpc), "插件域有后台自动更新循环");
ok(/readAppSettingsSync\(app\.getPath\("userData"\)\)\.pluginAutoUpdate/.test(pluginsIpc), "循环读 pluginAutoUpdate（关着安静退出）");
ok(/checkMarketPluginUpdates\(marketDir\)/.test(pluginsIpc) && /checkOfficialPluginUpdates\(officialDir\)/.test(pluginsIpc), "两个市场都检查");
ok(/findMarketPlugin\(row\.slug\)[\s\S]{0,200}installMarketPlugin\(plugin\)/.test(pluginsIpc), "Gitee 插件有新版才重装");
ok(/findOfficialMarketPlugin\(row\.slug\)[\s\S]{0,200}installOfficialMarketPlugin\(\{ plugin, marketDir: officialDir \}\)/.test(pluginsIpc), "官方插件有新版才重装");
ok(/let autoUpdateRunning = false/.test(pluginsIpc) && /if \(autoUpdateRunning\) return/.test(pluginsIpc), "防重入");
ok(/finally \{ autoUpdateRunning = false; \}/.test(pluginsIpc), "异常也释放重入闸");
ok(/ctx\.effect\(\(\) => \{ clearTimeout\(autoUpdateKick\); clearInterval\(autoUpdateTimer\); \}\)/.test(pluginsIpc), "定时器随 feature 释放");

console.log("【④ 技能自动更新仍是同一条链】");
const skillsIpc = read("electron/features/skills-ipc.ts");
ok(/runSkillAutoUpdate/.test(skillsIpc) && /checkSkillUpdateRows\(\)/.test(skillsIpc), "技能后台循环存在并复用检查函数");
ok(/row\.state !== "update"[\s\S]{0,120}updateSkillFolder\(row\.folder\)/.test(skillsIpc), "技能只更新有变化的项");
ok(/readAppSettingsSync\(app\.getPath\("userData"\)\)\.skillAutoUpdate/.test(skillsIpc), "技能循环读 skillAutoUpdate");

console.log("【⑤ 台账同步】");
const ledger = read("docs/FEATURE-LEDGER.md");
ok(/插件自动更新|两个总开关|技能 \/ 插件/.test(ledger), "FEATURE-LEDGER 已记录本条");

console.log(`\n${checks - fails}/${checks} 通过${fails ? " —— 有 ✗，先修再提交" : " —— 全绿"}`);
process.exit(fails ? 1 : 0);
