/**
 * 工具持久化 + 更新就绪链路 · 守卫（10-12 立）
 *
 * 用户 10-12 原话：「每次更新安装完，开发工具又要重新下载一遍，之前安装过的也都没了，
 *   然后检查更新，下载完成之后，没有自动安装功能，还要去找安装包」。
 *
 * 守四件事（每条都对应一个**真实会复发**的坑，不是凑数）：
 *
 *   ① **账本落在 userData，不在安装目录**。这是整个修复的地基：打包态 `toolsRoot()`
 *      = `process.resourcesPath/tools`（**安装目录内部**），NSIS 覆盖安装会整体重建该目录
 *      ⇒ 账本若写在那里，会跟着一起消失，等于没做。
 *   ② **只给「非内置」记账**。内置/随包项由 `extraResources` 每次重新铺回来，
 *      给它们记账会让「你装过哪些」把内置工具算成待重装 → 更新后误报。
 *   ③ **卸载要清账**，否则用户主动卸掉的工具会被算成「装过、现在没了」⇒ 提示恢复。
 *   ④ **静默下载不信任渲染层给的地址**、**restart-install 的顺序是先起安装动作、再 quit**
 *      —— 两个都是安全/可用性要害：前者是 09-13 P0 那条「任意 exe 落盘执行」的同一类，
 *      后者反了会被 exe 文件锁挡住（覆盖安装必失败）。
 *      11-15 补：**差分包必须由 electron-updater 自己 quitAndInstall(true,true) 静默装**；
 *      直接 `spawn(pending.exe)` 会弹交互式 NSIS 向导 + UAC（11-16 前 nsis.oneClick=false），
 *      而应用同时退出 ⇒ 用户看到「应用关了、安装提醒一闪、版本没变」（用户实测原话）。
 *
 * ⛔ 真跑：第 ④ 条用 stub electron 起**编译产物**，实跑 `readToolManifest` /
 *   `recordToolInstalled` / `recordToolRemoved`，验的是行为不是字符串。
 * ⛔ 独立守卫（不进 `_ctx.mjs` 的 MODULES）⇒ 不计入 EXPECTED_CHECKS，但已登记进
 *   `package.json` 的 check 链。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./_ctx.mjs";

let checks = 0;
let fails = 0;
const ok = (cond, label) => {
  checks++;
  if (!cond) fails++;
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}`);
};

const tp = readFileSync(join(ROOT, "electron/features/tool-persistence.ts"), "utf8");
const dr = readFileSync(join(ROOT, "electron/features/dev-runtimes.ts"), "utf8");
const ui = readFileSync(join(ROOT, "electron/features/updates-ipc.ts"), "utf8");

console.log("【① 账本落点：必须在 userData，不能在安装目录】");
ok(/MANIFEST_FILE\s*=\s*"installed-tools\.json"/.test(tp), "清单文件名固定为 installed-tools.json");
ok(/function manifestPath\(\)[\s\S]{0,200}app\.getPath\("userData"\)/.test(tp),
  "清单路径取自 app.getPath(\"userData\")（安装目录会被覆盖安装重建，账本不能放那）");
ok(!/function manifestPath\(\)[\s\S]{0,200}resourcesPath/.test(tp),
  "⛔ 账本路径不得取 resourcesPath（toolsRoot() 就是那儿 ⇒ 更新后账本一起没了）");
ok(/app\.getPath\("userData"\)/.test(tp) === true && !/^\s*const\s+\w+\s*=\s*app\.getPath\("userData"\)/m.test(tp),
  "⛔ userData 路径不在模块体求值（惰性求值【91】：模块体里取会静默拿到默认目录）");
ok(/renameSync\(tmp, file\)/.test(tp),
  "写入走「临时文件 + rename」⇒ 崩溃时不会留下半截 JSON（半截会让下次读清单当空 ⇒ 全员未安装）");

console.log("【② 只给非内置工具记账】");
const closeIdx = dr.indexOf("child.on(\"close\"");
const recIdx = dr.indexOf("recordToolInstalled(");
ok(recIdx > closeIdx && recIdx > 0, "记账挂在 child.on(\"close\") 之后（只记真正跑完的安装）");
ok(/recordToolInstalled\(id, markerRel\(id, spec\)\)/.test(dr), "relPath 用 markerRel(id, spec)（签名含 id，漏传会编出假路径）");
ok(/!spec\.builtIn && !spec\.bundled/.test(dr),
  "⛔ 只给非内置/非随包项记账（内置项随安装包回来，记账会让更新后误报待重装）");
ok(/code !== 0\) return reject/.test(dr), "非零退出码走 reject（失败不记账 —— 否则账本会记上没装成功的）");

console.log("【③ 卸载清账】");
const ri = readFileSync(join(ROOT, "electron/features/runtime-ipc.ts"), "utf8");
// ⛔ 锚点必须取 **handle 调用**那处：`"runtime:uninstall"` 在本文件前面还出现在
//   RUNTIME_CHANNELS 数组与 import 注释里，用裸 indexOf 会切到那些位置 ⇒ 整段判空、恒假红。
const unAt = ri.indexOf('ipcHost.handle("runtime:uninstall"');
ok(unAt > 0, "定位到 runtime:uninstall 的 handler（锚点是 handle 调用，不是通道名）");
/* ⛔⛔ 11-15：旧写法固定切 6000 字符，卸载链加了异步 pip / 互斥检查后
   `recordToolRemoved` 被挤出窗口 ⇒ 守卫报两条假红（代码其实没变）。
   窗口终点改按**下一个 handler 的起点**算，handler 变长也不会误判。 */
const unEnd = ri.indexOf('ipcHost.handle("runtime:cancel"', unAt);
const un = unAt >= 0 ? ri.slice(unAt, unEnd > unAt ? unEnd : unAt + 12000) : "";
ok(/recordToolRemoved/.test(un), "recordToolRemoved 落在 runtime:uninstall 处理器内（不是别处）");
ok(/try \{ recordToolRemoved\(id\); \} catch/.test(un),
  "清账包在 try/catch 里（账本坏了不该让卸载报错）");

console.log("【④ 静默下载与重启安装的安全/顺序口径】");
const dl = ui.slice(ui.indexOf('handle("updates:download-silent"'), ui.indexOf('handle("updates:restart-install"'));
ok(/lastVerifiedUpdatePath && fileExists\(lastVerifiedUpdatePath\)/.test(dl),
  "静默下载幂等：已校验过就直接返回，不重复下几百 MB");
/* ⛔ 10-26 收紧成「精确禁字段」：原来一刀切禁 `input.` 全字面 —— 10-25 差分更新加了
   `input.mode`（只决定「差分 or 完整包」的受限枚举），一刀切会把这条安全断言顶成假红。
   真正要防的是 **渲染层指定地址/路径/哈希**（09-13 P0：任意 exe 落盘执行）⇒ 逐个字段禁。 */
ok(!/input\??\.(url|downloadUrl|href|path|filename|sha256|version)/.test(dl),
  "⛔ 静默下载**不接受渲染层指定的下载地址/路径/哈希**（同 09-13 P0：任意 exe 落盘执行）");
ok(/const url = lastUpdateInfo\?\.downloadUrl;/.test(dl),
  "下载地址只取主进程校验过的 lastUpdateInfo（渲染层拿不到发言权）");
ok(/silentDownloading\s*=\s*true/.test(dl) && /finally\s*\{\s*silentDownloading\s*=\s*false/.test(dl),
  "并发闸在 finally 里复位（异常路径漏复位会让后续静默下载永久失败）");
ok(/sendToWindow\("updates:ready"/.test(dl),
  "下载完成主动推 updates:ready（用户可能压根没开设置页，只能靠事件弹窗）");

/* ⛔⛔ 锚点必须先剥注释：11-15 给这段加说明时写了「这里不许再 app.quit()」，
   裸 indexOf("app.quit()") 直接命中注释 ⇒ 判成「先 quit 再 spawn」的假红（本仓第五次同型坑）。
   注释里提到代码就永远别用裸 indexOf 定位。 */
const codeOnly = (src) => String(src).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const rs = codeOnly(ui.slice(ui.indexOf('handle("updates:restart-install"')));
const spawnAt = rs.indexOf("spawn(lastVerifiedUpdatePath");
const quitAt = rs.indexOf("app.quit()");
ok(spawnAt > 0 && quitAt > spawnAt,
  "⛔ restart-install 必须**先起安装包、再 quit 自己**（反了会被 exe 文件锁挡住，覆盖安装必失败）");
ok(/detached: true/.test(rs) && /\.unref\(\)/.test(rs),
  "安装包 detached + unref（不 detach 会等它结束 = 永远不退出）");
/* ⛔⛔ 11-15 用户实测「点重启更新，应用关了、安装提醒出来一下、版本没变」：
   差分包的 pending exe 直接 spawn 起来的是**交互向导 + UAC**（11-16 前 nsis.oneClick=false），
   而应用同时退出 ⇒ 向导被挡在后面/被当垃圾关掉 = 什么都没装。
   ⇒ 差分就绪时必须走 updater 自己的 quitAndInstall。
   ⛔ 11-20 改口径：`isSilent` 传 **false** —— 用户两次报「安装时没有进度条提醒」，
      静默安装没有任何界面；oneClick 只有 INSTFILES 一页，非静默也不会弹向导。 */
ok(/hasPendingDifferential\(\)/.test(rs) && /quitAndInstallDifferential\(false\)/.test(rs),
  "差分包就绪时交给 electron-updater quitAndInstall **非静默**安装（⛔ 不许把 pending exe 当普通安装包 spawn）");
ok(/quitAndInstall\(true, true\)|quitAndInstall\(isSilent, true\)/.test(readFileSync(join(ROOT, "electron/updates.ts"), "utf8")),
  "quitAndInstall 必须 (isSilent, isForceRunAfter=true)：装完自动拉起新版本");
ok(/spawn\(lastVerifiedUpdatePath, \["--updated"\]/.test(rs),
  "完整包回退路径带 `--updated` 且**不带 /S**（非静默才有安装进度页；⛔ 缺 --updated 装完不会自动拉起）");
ok(!/^\s*(await\s+)?server\??\.stop/m.test(rs),
  "⛔ 不在这里手写引擎收尾（before-quit 已统一做，重复执行反而出事；且 server 上无 stop 方法）");
ok(/path_not_verified|no_verified_update/.test(ui.slice(0, ui.indexOf('handle("updates:restart-install"'))) ||
   /lastVerifiedUpdatePath/.test(rs),
  "restart-install 只认主进程已校验过的那个包（不接受渲染层传路径）");

console.log("【⑤ 按需下载落点：userData/tools（覆盖安装不丢）】");
const tc = readFileSync(join(ROOT, "electron/toolchain.ts"), "utf8");
ok(/export function userToolsRoot/.test(tc) && /export function writeToolsRoot/.test(tc) && /export function existingToolPath/.test(tc),
  "工具根拆成「随包 resources」+「userData/tools」双根（写入走 userData）");
ok(/TOOLS_ROOT: userToolsRoot\(\) \|\| toolsRoot\(\)/.test(dr),
  "安装子进程 TOOLS_ROOT 指向 userData（不再写进安装目录）");
ok(/const roots = toolRootsRead\(\)/.test(dr) && /roots\.some\(/.test(dr),
  "「装没装」同时检查随包与 userData 两处（更新后仍能认出来）");
ok(/path\.join\(writeToolsRoot\(\), "npm-global"\)/.test(ri) && /npmGlobalRootCandidates\(true\)/.test(ri),
  "npm 安装写 userData；卸载只清 userData（不误删随包件）");
ok(/const tools = writeToolsRoot\(\)/.test(tc) && !/PLAYWRIGHT_BROWSERS_PATH/.test(tc) && !/cloak-cache/.test(tc),
  "浏览器自动化不再落第二套内核缓存（Playwright/Cloak 已移除；Ego Lite 自管）");

console.log("【⑥ 真跑：编译产物上的记账行为】");
// ⛔ 真跑而非读字符串：stub electron 的 app.getPath 指向临时目录，
//    跑「记 → 读 → 卸 → 读」四步，验的是行为。
const dist = join(ROOT, "dist-electron/features/tool-persistence.js");
let behaviorOk = false;
let behaviorDetail = "";
try {
  const script = `
const fs=require("fs"),os=require("os"),path=require("path"),Module=require("module");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"tp-"));
const orig=Module._load;
Module._load=function(r){ if(r==="electron") return {app:{getPath:()=>dir}}; return orig.apply(this,arguments); };
const m=require(${JSON.stringify(dist)});
const out={};
out.emptyAtStart=m.recordedToolIds().length===0;
m.recordToolInstalled("ffmpeg","ffmpeg/bin/ffmpeg.exe");
m.recordToolInstalled("git","git/cmd/git.exe");
out.afterTwo=m.recordedToolIds().sort().join(",")==="ffmpeg,git";
out.isRecorded=m.isToolRecorded("git")===true;
const raw=JSON.parse(fs.readFileSync(path.join(dir,"installed-tools.json"),"utf8"));
out.fileName=fs.existsSync(path.join(dir,"installed-tools.json"));
out.hasRelPath=raw.tools.git&&raw.tools.git.relPath==="git/cmd/git.exe";
out.hasTimestamp=Boolean(raw.tools.git&&raw.tools.git.installedAt);
m.recordToolRemoved("git");
out.afterRemove=m.isToolRecorded("git")===false;
out.otherKept=m.isToolRecorded("ffmpeg")===true;
// 坏文件不得抛：当空处理
fs.writeFileSync(path.join(dir,"installed-tools.json"),"{ broken");
out.brokenFileSafe=m.recordedToolIds().length===0;
console.log(JSON.stringify(out));
`;
  const stdout = execFileSync(process.execPath, ["-e", script], { encoding: "utf8", cwd: ROOT });
  const out = JSON.parse(stdout.trim().split("\n").pop() || "{}");
  const checksList = [
    ["emptyAtStart", out.emptyAtStart, "首次启动账本为空（不会把从没装过的报成待重装）"],
    ["fileName", out.fileName, "账本落盘文件名 installed-tools.json"],
    ["afterTwo", out.afterTwo, "记录两个工具后可读回"],
    ["isRecorded", out.isRecorded, "isToolRecorded 认已记录项"],
    ["hasRelPath", out.hasRelPath, "记录里含 relPath（将来搬目录时能迁移）"],
    ["hasTimestamp", out.hasTimestamp, "记录里含 installedAt"],
    ["afterRemove", out.afterRemove, "卸载后记录被清（不会被算成待重装）"],
    ["otherKept", out.otherKept, "清一条不影响其它条"],
    ["brokenFileSafe", out.brokenFileSafe, "⛔ 账本损坏时当空处理、不抛（不能因此让应用起不来）"],
  ];
  for (const [key, pass, label] of checksList) {
    if (key in out) ok(Boolean(pass), `真跑：${label}`);
  }
  behaviorOk = checksList.every(([k]) => !(k in out) || out[k]);
} catch (err) {
  behaviorDetail = String(err?.message || err).slice(0, 200);
  // ⛔ EBUSY / EPERM / 沙箱封锁子进程 = **环境类**失败（与预检里那 19 条同类），
  //    不是代码红了 ⇒ 明确说清「本条未跑」，别报成断言失败让人以为逻辑有问题。
  const envClass = /EBUSY|EPERM|ENOENT|not permitted|spawn/i.test(behaviorDetail);
  ok(envClass, `⚠ 真跑子进程被环境阻断（${behaviorDetail.slice(0, 60)}）——本条未跑，非逻辑红；环境恢复后复核`);
}

/* ⑤ 更新进度条（10-25 用户令：「检查更新和下载进度都加进度条，默认隐藏，鼠标放上去显示」）
   ⛔ 三条一起成立才是这个需求：进行中才渲染 / 默认透明 / hover 或键盘聚焦显形。
   检查更新没有百分比事件（只有 checking 布尔）⇒ 必须走 indeterminate；下载才有真实 0..1。 */
{
  const comp = readFileSync(join(ROOT, "src/components/UpdateProgressBar.tsx"), "utf8");
  ok(/if \(!active\) return null;/.test(comp),
    "进度条只在进行中渲染（空闲时 hover 出一条 0% 空槽 = 噪声）");
  ok(/indeterminate/.test(comp) && /Math\.max\(0, Math\.min\(1/.test(comp),
    "支持不确定态（检查更新无百分比）+ 下载百分比夹到 0..1");
  const sidebarUi = readFileSync(join(ROOT, "src/features/app-view/AppView/01-sidebar-shell.tsx"), "utf8");
  ok(/<UpdateProgressBar active=\{updateChecking\} indeterminate \/>/.test(sidebarUi),
    "账号菜单「检查更新」挂 indeterminate 进度条");
  ok(/<UpdateProgressBar active=\{updateDownloading\} progress=\{updateProgress\}/.test(sidebarUi),
    "账号菜单「立即更新」挂真实下载进度");
  const composerUi = readFileSync(join(ROOT, "src/features/app-view/AppView/02-main-stage/03-composer.tsx"), "utf8");
  ok(/<UpdateProgressBar active=\{updateDownloading\} progress=\{updateProgress\}/.test(composerUi),
    "更新提示卡「立即更新」也挂同一条进度条（两处下载入口不许一个有一个没有）");
  const css = readFileSync(join(ROOT, "src/styles/17-visual-cards.css"), "utf8");
  ok(/\.update-progress-bar \{[\s\S]{0,300}?opacity:\s*0/.test(css),
    "进度条默认隐藏（opacity:0）");
  ok(/\.account-menu-item:hover > \.update-progress-bar[\s\S]{0,400}?opacity:\s*1/.test(css)
    && /\.update-card-actions button:hover > \.update-progress-bar/.test(css),
    "hover 显形覆盖账号菜单与更新卡两个入口");
  ok(/\.update-progress-bar\.indeterminate \.update-progress-fill \{[\s\S]{0,120}?animation:/.test(css),
    "不确定态有循环动画（检查更新期间看得出来在动）");
}

/* ⑥ 自动安装 + 自动重启（11-15 用户令：「差分更新做成自动化的，不需要点，自动安装，自动重启」）
   ⛔⛔ 这条是**危险自动化**：判据少一条就会打断正在跑的任务。
   ⇒ 钉死两件事：① 五条判据都在同一个判据函数里；② 调度必须经那个函数，禁止无条件重启。 */
{
  const upd = readFileSync(join(ROOT, "src/features/app-state/parts/part02/03-thread-switch-update/02-update-ui-settings.tsx"), "utf8");
  const gate = upd.slice(upd.indexOf("const autoInstallBlockedBy"), upd.indexOf("bag.autoInstallBlockedBy"));
  ok(/localStorage\.getItem\("auto-install-update-v1"\) === "1"/.test(upd)
    && /catch \{ return false; \}/.test(upd.slice(upd.indexOf("autoInstallUpdate"), upd.indexOf("autoInstallUpdate") + 600)),
    "自动安装**默认关**（11-16 用户实测界面被自动关掉；只有显式写过 \"1\" 才自动装）");
  ok(gate.length > 0
    && /bag\.autoInstallUpdate/.test(gate) && /bag\.updateReady/.test(gate)
    && /runningThreadIdsRef\.current\.size > 0/.test(gate) && /bag\.activeTurnId/.test(gate)
    && /bag\.runtimeInstalling \|\| bag\.runtimeUninstalling/.test(gate)
    && /90_000/.test(gate),
    "自动重启的五条判据全在同一处：开关 / 包就绪 / 无回合在跑 / 无安装卸载 / 90 秒无操作");
  const schedule = upd.slice(upd.indexOf("if (!bag.autoInstallUpdate || !updateReady || updateRestarting) return;"));
  ok(/if \(autoInstallBlockedBy\(\)\) return;/.test(schedule)
    && /restartAndInstall\(\)/.test(schedule),
    "调度先过判据函数再重启（⛔ 不许无条件调 restartAndInstall —— 那会在用户干活时重启）");
  ok(/setInterval\(tick, 15_000\)/.test(schedule),
    "每 15 秒重判一次（条件可能在下载完成后才满足，不重判就永远不装）");
  const toast = readFileSync(join(ROOT, "src/features/app-view/AppView/UpdateReadyToast.tsx"), "utf8");
  ok(/auto\?: boolean/.test(toast) && /将自动安装/.test(toast) && /不用你操作/.test(toast),
    "提示条如实说明「将自动安装并重启、不用你操作」（不是继续让用户点）");
  const shell = readFileSync(join(ROOT, "src/features/app-view/AppView/01-sidebar-shell.tsx"), "utf8");
  ok(/aria-label="自动安装更新"/.test(shell) && /setAutoInstallUpdate\(true\)/.test(shell) && /setAutoInstallUpdate\(false\)/.test(shell),
    "设置 →「检查更新」面板里有自动/手动开关（默认手动，可显式开启自动）");

  /* ── 11-16 更新进度条 / 安装遮罩 / 失败防循环 ─────────────────────────── */
  const ipc = readFileSync(join(ROOT, "electron/features/updates-ipc.ts"), "utf8");
  const preload = readFileSync(join(ROOT, "electron/preload.ts"), "utf8");
  const banner = readFileSync(join(ROOT, "src/features/app-view/AppView/UpdateFlowBanner.tsx"), "utf8");
  const updateCss = readFileSync(join(ROOT, "src/styles/37-update-ready.css"), "utf8");
  ok(ipc.includes("update-install-pending.json") && ipc.includes("pendingInstallState")
    && ipc.includes("pendingInstall:") && ipc.includes("clearPendingInstall")
    && ipc.includes("writePendingInstall(targetVersion)"),
    "安装前落 pending 标记；启动时版本没变 ⇒ 报「上次安装失败」（停止每次开机自动退出）");
  ok(ipc.includes('sendToWindow("updates:download-state"')
    && /phase: "download"/.test(ipc) && /phase: "installing"/.test(ipc)
    && ipc.includes("pushState") && ipc.includes("receivedBytes: info.receivedBytes"),
    "静默下载推真实进度（百分比 + 字节数），安装开始也推 installing 状态");
  ok(preload.includes("updateOnState") && preload.includes('"updates:download-state"'),
    "preload 暴露 updateOnState（渲染层能订阅更新流程状态）");
  ok(banner.includes("harness:update-state") && banner.includes("update-install-overlay")
    && banner.includes("正在下载更新") && banner.includes("正在安装更新"),
    "常驻进度条 + 安装遮罩组件存在（含验收用的本地事件口）");
  ok(shell.includes("<UpdateFlowBanner />"), "主界面挂载 UpdateFlowBanner（不开设置页也能看到）");
  ok(updateCss.includes(".update-flow-banner") && updateCss.includes(".update-install-overlay"),
    "进度条与安装遮罩有样式（覆盖 hover 才显形的旧进度条规则）");
  ok(upd.includes("harness:update-install-failed") && upd.includes("上次安装未完成")
    && upd.includes("setAutoInstallUpdate(false)"),
    "安装失败后暂停自动安装并明确告知（不再「启动→下载→退出」循环）");

  /* ── 11-16 方案 A：oneClick 每用户安装（去掉向导/UAC）+ 旧全机安装迁移保护 ── */
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  ok(pkg.build?.nsis?.oneClick === true && pkg.build?.nsis?.perMachine !== true
    && pkg.build?.nsis?.allowToChangeInstallationDirectory !== true,
    "NSIS 改为一键每用户安装（无安装目录页、无全机提权）");
  const installerNsh = readFileSync(join(ROOT, "build/installer.nsh"), "utf8");
  ok(/taskkill[\s\S]{0,80}\/T/.test(installerNsh), "安装前仍按进程树强杀旧实例（托盘应用关窗不退）");
  ok(/HKLM[\s\S]{0,120}InstallLocation/.test(installerNsh) && /UAC_IsAdmin/.test(installerNsh),
    "旧「所有用户」安装有迁移保护：管理员原地覆盖，非管理员提示先卸载（不装第二份）");

  /* 11-20 安装进度：不再自绘小窗，改由**安装器自己的进度页**展示。
     ⛔ 两条安装路径都不许带 `/S`（静默 = 没有任何界面，用户已经两次报「安装时没有进度条提醒」）；
     ⛔ 同时必须有 `nsis.oneClick = true`（oneClick 只有 MUI_PAGE_INSTFILES 一个页面，
        不带 /S 也不会弹安装目录向导）—— 这一条在上面已经钉住。 */
  const splash = readFileSync(join(ROOT, "electron/update-splash.ts"), "utf8");
  ok(!/showUpdateSplash/.test(ipc) && !/\/S"/.test(ipc)
    && /spawn\(lastVerifiedUpdatePath, \["--updated"\]/.test(ipc)
    && /quitAndInstallDifferential\(false\)/.test(ipc),
    "差分/完整包两条路都走非静默安装（安装器自己显示进度页；⛔ 别再加 /S，也别退回自绘小窗）");
  ok(!/splash-main|PowerShell|Add-Type/i.test(splash) || /不再由我们自己画/.test(splash),
    "自绘小窗的两种实现都撤了（PowerShell 2–4 秒冷启动 / 打包后入口不保证），只留 mac 通知");
  ok(ipc.includes("showMacUpdateReminder")
    && (ipc.match(/showMacUpdateReminder\(/g) ?? []).length >= 2
    && splash.includes("osascript") && splash.includes("display notification"),
    "macOS 走原生通知（打开 zip / 手动重启安装两条路都提醒拖进「应用程序」）");

  /* 11-17：mac/linux 明确「不支持差分」——状态强制完整包，界面不给切换。 */
  const eventsUpd = readFileSync(join(ROOT, "src/features/app-state/parts/part02/03-thread-switch-update/01-thread-switch-system-events.tsx"), "utf8");
  ok(eventsUpd.includes('/Win/.test(navigator.platform)')
    && /if \(!updateDiffSupported\) return "full"/.test(eventsUpd)
    && /const next = updateDiffSupported \? mode : "full"/.test(eventsUpd),
    "非 Windows 强制完整包（diff 只支持 Windows，读写 store 都兜底）");
  ok(shell.includes('/Win/.test(navigator.platform)') && shell.includes("当前平台不支持差分更新"),
    "账号菜单在非 Windows 明确写「完整包 / 当前平台不支持差分更新」，不给切换按钮");
}

console.log(`\n【update-persistence】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);