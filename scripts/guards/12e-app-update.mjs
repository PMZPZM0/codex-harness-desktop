/**
 * 应用更新链 · 守卫（11-21 整份重写后新增，取代已删除的 12e-update-mirror / 12h-update-persistence）。
 *
 * 钉的是**用户实测过的四次翻车**的根因，不是实现细节：
 *   ① 下载完成必须变「就绪」且状态落盘（否则刷新/重启后徽标退回「更新」，点一下重下 669MB）；
 *   ② 下载前必须复用已校验的包（否则每次都从头下）；
 *   ③ 安装必须「起安装器 → 确认存活 → 退出自己」（`shell.openPath` 不退应用，NSIS 必失败）；
 *   ④ 旧链概念（electron-updater / blockmap / 差分 / 静默下载 / pending 标记 / 自绘小窗）不许复活。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./_ctx.mjs";

let checks = 0;
let fails = 0;
const ok = (cond, label) => {
  checks++;
  if (!cond) fails++;
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}`);
};
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

console.log("\n【① 旧链路已删彻底】");
for (const gone of ["electron/updates.ts", "electron/features/updates-ipc.ts", "electron/update-splash.ts"]) {
  ok(!existsSync(join(ROOT, gone)), `旧文件已删除：${gone}`);
}
for (const gone of ["src/features/app-view/AppView/UpdateFlowBanner.tsx", "src/components/UpdateProgressBar.tsx"]) {
  ok(!existsSync(join(ROOT, gone)), `旧界面已删除：${gone}`);
}

console.log("\n【② 服务层：唯一状态机 + 状态落盘 + 复用】");
const service = read("electron/update-service.ts");
ok(/export type UpdatePhase = "idle" \| "available" \| "downloading" \| "ready" \| "installing" \| "failed"/.test(service),
  "六个明确状态（⛔ 不许再有第二套派生状态）");
ok(/update-state\.json/.test(service) && /function persist\(/.test(service) && /function readPersisted\(/.test(service),
  "就绪状态落盘并可读回（跨重启仍是「安装」）");
ok(/async function isUsablePackage\([\s\S]{0,500}sha512/.test(service),
  "复用判据 = 字节数 + sha512（⛔ 只比大小会被半截包骗过）");
ok(/export async function downloadUpdatePackage[\s\S]{0,1200}await isUsablePackage\(target, feed\)/.test(service),
  "下载入口先复用已校验的包（⛔ 以前每次先 rm，等于把上轮 669MB 白扔）");
ok(/spawn\(file, \["--updated"\]/.test(service) && /setTimeout\(r, 900\)/.test(service) && /app\.quit\(\)/.test(service),
  "安装 = spawn `--updated` → 等 900ms 确认存活 → 退出自己");
ok(!/if \(process\.platform === "win32"\)[\s\S]{0,120}shell\.openPath/.test(service) && /darwin/.test(service),
  "Windows 不走 shell.openPath（那只打开安装器、应用不退 ⇒ 必然装不上）");

console.log("\n【③ IPC：三调用 + 一推送，且不接受渲染层给的地址】");
const ipc = read("electron/features/update-ipc.ts");
for (const ch of ["update:check", "update:download", "update:install"]) ok(ipc.includes(`"${ch}"`), `通道存在：${ch}`);
ok(/sendToWindow\("update:state"/.test(ipc), "状态只有一条推送：update:state");
ok(!/input\??\.(url|downloadUrl|path|filePath|sha)/.test(ipc), "⛔ 不接受渲染层指定下载地址 / 安装路径");

console.log("\n【④ 旧概念全仓绝迹（防复活）】");
/* ⛔ 分两档：
   · 本仓更新链专属名词（静默下载 / 待安装标记 / 旧推送通道）⇒ 全仓禁；
   · `electron-updater` / `blockmap` ⇒ 只在**更新链自己的文件**里禁 —— OpenFilm 等第三方
     App 的自动更新是它们自己的事，我们的注释里提到它属于正常描述，不是残留。 */
const bannedEverywhere = ["download-silent", "updates:download-state", "updates:ready", "update-install-pending"];
const bannedInUpdateChain = ["electron-updater", "current.blockmap", "differential"];
const updateChainFiles = new Set(["electron/update-service.ts", "electron/features/update-ipc.ts"]);
const offenders = [];
const walk = (rel) => {
  let entries = [];
  try { entries = readdirSync(join(ROOT, rel)); } catch { return; }
  for (const name of entries) {
    const childRel = rel ? `${rel}/${name}` : name;
    if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      let text = "";
      try { text = readFileSync(join(ROOT, childRel), "utf8"); } catch { continue; }
      const banned = updateChainFiles.has(childRel) ? [...bannedEverywhere, ...bannedInUpdateChain] : bannedEverywhere;
      for (const bad of banned) if (text.includes(bad)) offenders.push(`${childRel} → ${bad}`);
    } else if (!name.includes(".")) {
      walk(childRel);
    }
  }
};
walk("electron");
walk("src");
ok(offenders.length === 0, `旧更新概念已绝迹（命中：${offenders.slice(0, 3).join(" · ") || "无"}）`);

console.log("\n【⑤ 渲染层只认推送】");
const hook = read("src/features/app-update/use-app-update.ts");
ok(/updateOnState/.test(hook) && !/hasUpdate/.test(hook), "只订阅 update:state（⛔ 不自己派生「是否已下载」）");
const badge = read("src/features/app-update/UpdateBadge.tsx");
ok(/phase === "ready"[\s\S]{0,120}install\(\)/.test(badge) && /phase === "available"[\s\S]{0,80}download\(\)/.test(badge),
  "徽标映射：ready → 安装、available → 下载（⛔ 两态不许混成一个按钮）");

console.log("\n【⑥ 闭环审查（11-21）三处断点必须有出口】");
/* ① 重启后 ready 推不到界面：本域在 nextTick 挂载，早于窗口创建 ⇒ 推送发给不存在的窗口。
   ⇒ 必须订阅「主窗口加载完成」重放一次（idle 不推）。 */
ok(/onPrimaryWindowLoaded\(/.test(ipc) && /sendToWindow\("update:state", state\)/.test(ipc) && /phase === "idle"[\s\S]{0,40}return/.test(ipc),
  "① 主窗口加载完成时重放快照（idle 不推）—— 否则重启后徽标看不到已就绪的包");
ok(/export function onPrimaryWindowLoaded/.test(read("electron/features/window-bus.ts"))
  && /did-finish-load/.test(read("electron/features/window-bus.ts")),
  "① 基座提供「页面加载完成」时机（window-bus，did-finish-load）");
/* ② 安装包被磁盘清理/杀软删掉：旧写法只 return 不 emit ⇒ 徽标停在「安装」，点了没反应。
   ⇒ 必须回落 failed（徽标变「重试」= 有出口）。 */
ok(/没有已下载的安装包[\s\S]{0,400}emit\(\{ phase: "failed"/.test(service),
  "② 包丢失时回落 failed（不再「点了没反应」）；徽标「重试」→ check → available 闭环");
/* ③ ready 不能只信内存快照 —— 检查更新时要便宜地验一次文件还在且大小对。 */
ok(/snapshot\.phase === "ready"[\s\S]{0,420}statSync\(snapshot\.path\)/.test(service),
  "③ ready 复验磁盘文件（存在 + 字节数对），被删则重新落 available");
/* ④ NSIS：应用内更新（--updated）必须跳过「请先卸载旧版」拦路 —— oneClick 有进度页 =
   非静默，只判 ${Silent} 会让从应用里点的安装直接 Quit（11-20 的老问题在非静默路径复发）。 */
const nsh = read("build/installer.nsh");
ok(/GetOptions\} \$R9 "--updated"/.test(nsh) && /IfNot\} \$\{Errors\}/.test(nsh),
  "④ 安装器用 --updated 识别应用内更新，跳过全机安装拦路（⛔ 不能只看 ${Silent}）");
ok(/!include "FileFunc\.nsh"/.test(nsh), "④ installer.nsh 显式引入 FileFunc（GetParameters / GetOptions）");

console.log(`\n【app-update】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
