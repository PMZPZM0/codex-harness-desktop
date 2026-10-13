#!/usr/bin/env node
/**
 * 12j-skill-auto-update —— 技能自动更新（10-13 用户令）的守卫。
 *
 * 钉的都是「真会复发的坑」：
 *  ① 技能更新卡片只许从技能页移除，⛔ 不得连带把插件/官方插件的更新面板弄丢（共用组件）；
 *  ② 手动链与自动链必须同一个函数（checkSkillUpdateRows / updateSkillFolder）——
 *     两处各写一遍判据必然漂移（「面板说最新、后台又更新」类怪象）；
 *  ③ 后台循环三道闸：开关默认关、防重入、单技能失败不影响其余；
 *  ④ 开关走 appSettings（无新 IPC 通道），界面用 ToggleSwitch（原生 checkbox 会画错，见 12i）；
 *  ⑤ FEATURE-LEDGER 有对应条目（清单机制本身是 AGENTS.md 的硬规则）。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

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

console.log("【① 卡片移除只限技能页】");
const skillsPage = read("src/features/settings-skills/SkillsCenterSection.tsx");
ok(!/MarketUpdatePanel/.test(skillsPage), "技能页不再引用 MarketUpdatePanel（大卡片已移除）");
const pluginsPage = read("src/features/settings-plugins/PluginsMarketSection.tsx");
ok(/MarketUpdatePanel kind="plugins"/.test(pluginsPage) && /MarketUpdatePanel kind="official"/.test(pluginsPage),
  "⛔ 插件页的两个更新面板仍在（共用组件不得误伤）");
const panel = read("src/features/market-updates/MarketUpdatePanel.tsx");
ok(panel.length > 0, "market-updates 板块本体保留（插件页还要用）");
/* ⛔ 10-13 鬼畜循环修复的防回归：apiOf 每次渲染返回新对象 ⇒ check 的 useCallback 依赖每轮变
   ⇒ useEffect([check]) 每轮渲染重新检查 → setState → 再渲染（无限循环，按钮常驻「检查中…」）。
   断言锚 useMemo 接线本身 + 负向禁裸调用（改回去 = 循环回来）。 */
ok(/const api = useMemo\(\(\) => apiOf\(props\.kind\), \[props\.kind\]\)/.test(panel),
  "⛔ api 按 kind 记忆化（裸 apiOf 每轮新对象 = 检查无限循环，实测「一直检查中+鬼畜」）");
ok(!/const api = apiOf\(/.test(codeOnly(panel)), "负向：不许退回裸 apiOf 调用");

console.log("【② 手动链 = 自动链（单一真相源）】");
const ipc = read("electron/features/skills-ipc.ts");
ok(/async function checkSkillUpdateRows\(/.test(ipc), "检查逻辑抽成 checkSkillUpdateRows");
ok(/async function updateSkillFolder\(/.test(ipc), "更新逻辑抽成 updateSkillFolder");
ok(/handle\("skills:update-check", async \(\) => checkSkillUpdateRows\(\)\)/.test(ipc),
  "手动检查处理器 = 直接调同一函数");
ok(/handle\("skills:update", async \(_event, folder: string\) => updateSkillFolder\(folder\)\)/.test(ipc),
  "手动更新处理器 = 直接调同一函数");
ok(/runSkillAutoUpdate[\s\S]{0,400}checkSkillUpdateRows\(\)/.test(ipc), "后台循环走同一个检查函数");
ok(/row\.state !== "update"[\s\S]{0,120}updateSkillFolder\(row\.folder\)/.test(ipc),
  "后台循环只更新 state=update 的项，走同一个更新函数");

console.log("【③ 后台循环的三道闸】");
ok(/let autoUpdateRunning = false/.test(ipc) && /if \(autoUpdateRunning\) return/.test(ipc),
  "防重入闸（上一轮没跑完不开新一轮）");
ok(/readAppSettingsSync\(app\.getPath\("userData"\)\)\.skillAutoUpdate/.test(ipc),
  "闸一：开关读 app-settings（默认 undefined = 关，不更新）");
ok(/if \(!enabled\) return/.test(ipc), "关着就安静退出");
ok(/catch \{ \/\* 单个失败[\s\S]{0,40}\*\/ \}/.test(ipc) || /try \{ await updateSkillFolder\(row\.folder\); \}[\s\S]{0,80}catch/.test(ipc),
  "闸二：单技能失败只跳过该技能，不影响其余");
ok(/finally \{ autoUpdateRunning = false; \}/.test(ipc), "异常也要释放重入闸");
ok(/ctx\.effect\(\(\) => \{ clearTimeout\(autoUpdateKick\); clearInterval\(autoUpdateTimer\); \}\)/.test(ipc),
  "定时器随 feature 释放摘除（防泄漏）");
ok(/installCocoLoopSkill\(\{[\s\S]{0,200}onProgress/.test(ipc),
  "更新复用市场安装链（含安全检查），不是另写一条覆盖逻辑");

console.log("【④ 开关接线】");
const settings = read("electron/app-settings.ts");
ok(/skillAutoUpdate\?: boolean/.test(settings), "AppSettings 有 skillAutoUpdate（默认 undefined = 关）");
const manifest = read("electron/ipc-channels.manifest.json");
// ⛔ 别用 match 正则切 JSON 条目（惰性匹配没锚点会切到空串，12i 同款教训）——按锚点切片
const readCh = manifest.slice(manifest.indexOf('"channel": "appSettings:read"'), manifest.indexOf('"channel": "appSettings:read"') + 700);
const saveCh = manifest.slice(manifest.indexOf('"channel": "appSettings:save"'), manifest.indexOf('"channel": "appSettings:save"') + 900);
ok(/skillAutoUpdate\?: boolean/.test(readCh), "appSettings:read 返回类型含 skillAutoUpdate");
ok(/skillAutoUpdate\?: boolean/.test(saveCh), "appSettings:save 参数类型含 skillAutoUpdate");
// ⛔ 10-13 用户令「开关统一到控制台」之后，技能那把开关**搬出了技能中心**，落到控制台的
//    AutoUpdateCard（同一状态的第二个入口会让用户以为两边不一致）。保证没丢，落点变了。
const consoleCard = read("src/features/settings-general/AutoUpdateCard.tsx");
ok(/ToggleSwitch checked=\{row\.enabled\}|checked=\{row\.enabled\}/.test(consoleCard),
  "开关仍用共享 ToggleSwitch（原生 checkbox 会画错）—— 落点在控制台卡片");
ok(!/ToggleSwitch checked=\{skillAutoUpdate\}/.test(skillsPage),
  "⛔ 技能中心**不再**各放一个开关（控制台是唯一入口）");
ok(/window\.codex\.setAutoUpdate\(row\.id, enabled\)/.test(consoleCard)
  && /setRows\(\(current\) => current\.map\(\(entry\) => \(entry\.id === row\.id \? \{ \.\.\.entry, enabled: !enabled \} : entry\)\)\)/.test(consoleCard),
  "开关经由统一的 setAutoUpdate 写回，失败回滚本地状态");
ok(/AUTO_UPDATE_ROW_OWNER/.test(settings) && /"market-skill": "skillAutoUpdate"/.test(settings),
  "market-skill 动态行归属技能内容开关（同一把开关，不再有第二套判据）");

console.log("【⑤ 台账同步（AGENTS.md 硬规则）】");
const ledger = read("docs/FEATURE-LEDGER.md");
ok(/技能自动更新/.test(ledger) && /移除.*技能更新提醒卡片|技能更新.*卡片/.test(ledger),
  "FEATURE-LEDGER 已记录本条功能与卡片移除");

console.log(`\n${checks - fails}/${checks} 通过${fails ? " —— 有 ✗，先修再提交" : " —— 全绿"}`);
process.exit(fails ? 1 : 0);
