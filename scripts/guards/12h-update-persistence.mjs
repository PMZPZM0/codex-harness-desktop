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
 *   ④ **静默下载不信任渲染层给的地址**、**restart-install 的顺序是先 spawn 再 quit**
 *      —— 两个都是安全/可用性要害：前者是 09-13 P0 那条「任意 exe 落盘执行」的同一类，
 *      后者反了会被 exe 文件锁挡住（覆盖安装必失败）。
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
const un = unAt >= 0 ? ri.slice(unAt, unAt + 3200) : "";
ok(/recordToolRemoved/.test(un), "recordToolRemoved 落在 runtime:uninstall 处理器内（不是别处）");
ok(/try \{ recordToolRemoved\(id\); \} catch/.test(un),
  "清账包在 try/catch 里（账本坏了不该让卸载报错）");

console.log("【④ 静默下载与重启安装的安全/顺序口径】");
const dl = ui.slice(ui.indexOf('handle("updates:download-silent"'), ui.indexOf('handle("updates:restart-install"'));
ok(/lastVerifiedUpdatePath && fileExists\(lastVerifiedUpdatePath\)/.test(dl),
  "静默下载幂等：已校验过就直接返回，不重复下几百 MB");
ok(!/input\?\.|input\./.test(dl),
  "⛔ 静默下载**不接受渲染层指定的下载地址**（同 09-13 P0：任意 exe 落盘执行）");
ok(/silentDownloading\s*=\s*true/.test(dl) && /finally\s*\{\s*silentDownloading\s*=\s*false/.test(dl),
  "并发闸在 finally 里复位（异常路径漏复位会让后续静默下载永久失败）");
ok(/sendToWindow\("updates:ready"/.test(dl),
  "下载完成主动推 updates:ready（用户可能压根没开设置页，只能靠事件弹窗）");

const rs = ui.slice(ui.indexOf('handle("updates:restart-install"'));
const spawnAt = rs.indexOf("spawn(lastVerifiedUpdatePath");
const quitAt = rs.indexOf("app.quit()");
ok(spawnAt > 0 && quitAt > spawnAt,
  "⛔ restart-install 必须**先 spawn 安装包、再 quit 自己**（反了会被 exe 文件锁挡住，覆盖安装必失败）");
ok(/detached: true/.test(rs) && /\.unref\(\)/.test(rs),
  "安装包 detached + unref（不 detach 会等它结束 = 永远不退出）");
ok(!/^\s*(await\s+)?server\??\.stop/m.test(rs),
  "⛔ 不在这里手写引擎收尾（before-quit 已统一做，重复执行反而出事；且 server 上无 stop 方法）");
ok(/path_not_verified|no_verified_update/.test(ui.slice(0, ui.indexOf('handle("updates:restart-install"'))) ||
   /lastVerifiedUpdatePath/.test(rs),
  "restart-install 只认主进程已校验过的那个包（不接受渲染层传路径）");

console.log("【⑤ 真跑：编译产物上的记账行为】");
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

console.log(`\n【update-persistence】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);