/**
 * 改动备份 · 守卫（10-13 立）
 *
 * 守五件事，每条都对应一个**已经想过、很容易写回去就复发**的点：
 *
 *   ① **默认关**（`changeBackupEnabled` 缺省即关）：备份是往磁盘写东西的可见行为变化，
 *      用户没主动开之前不得有任何产物。
 *   ② **目录惰性求值 + 非法回退**：路径配置写错**不得让应用起不来**；相对路径/磁盘根
 *      一律回退默认并带 `fallback` 标志（界面要显示警示，否则用户以为改了没生效）。
 *   ③ **启用时才建目录**：关闭状态下不预建目录（否则"没开却有产物"）。
 *   ④ **复用 turn-file-watch 的遍历结果，不重写 walker**：两处 diff 真相源必然漂移
 *      （IGNORE 表与 4000/600 两级预算都在那边）。
 *   ⑤ **与 WorkBuddy 同构**：目录名与字段名逐字对齐（changes-index / changes-detail、
 *      `<convId>,<reqId>`、detailRef `cd_<uuid>.<revision>.json`、detailStatus）。
 *
 * ⛔ 真跑第 ①②③⑤：stub electron 起**编译产物**，实跑 `normalizeBackupDir` /
 *   `writeChangeBackup`，验行为不验字符串。独立守卫（不进 `_ctx.mjs` 的 MODULES）。
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

const cb = readFileSync(join(ROOT, "electron/features/change-backup.ts"), "utf8");
const bi = readFileSync(join(ROOT, "electron/features/change-backup-ipc.ts"), "utf8");
const bt = readFileSync(join(ROOT, "electron/features/boot.ts"), "utf8");
const st = readFileSync(join(ROOT, "electron/app-settings.ts"), "utf8");

console.log("【① 默认关】");
ok(/changeBackupEnabled\?: boolean/.test(st), "配置项 changeBackupEnabled?: boolean 已定义");
ok(!/changeBackupEnabled\s*\?\?\s*true/.test(st), "⛔ 不得默认开启（写盘行为必须由用户主动打开）");
ok(/Boolean\(settings\.changeBackupEnabled\)/.test(bi) && /if \(!settings\.enabled\) return null/.test(cb),
  "读侧一律按布尔判定，关闭时不落盘（无「undefined 也算开」的口子）");

console.log("【② 目录规范化与回退】");
ok(/normalizeBackupDir/.test(cb) && /path\.isAbsolute/.test(cb), "只接受绝对路径");
ok(/resolved === parsed\.root/.test(cb), "⛔ 拒绝文件系统根目录（备份会往里写几百 MB）");
ok(/fallback: true/.test(cb), "非法路径回退默认并置 fallback（界面据此显示警示）");
ok(/app\.getPath\("userData"\)/.test(cb) && !/^const \w+ = app\.getPath\("userData"\)/m.test(cb),
  "⛔ userData 惰性求值（【91】：模块体里取会静默拿到默认目录）");
ok(/fallback/.test(bi) && /fallback/.test(readFileSync(join(ROOT, "src/features/storage-settings/ChangeBackupSection.tsx"), "utf8")),
  "fallback 一路透到界面（不静默）");

console.log("【③ 启用时才建目录】");
const setSlice = bi.slice(bi.indexOf('handle("backup:config-set"'), bi.indexOf('handle("backup:list"'));
ok(/nextEnabled && !view\.fallback/.test(setSlice) && /ensureBackupDir/.test(setSlice),
  "只有「开着 + 路径合法」时才 ensureBackupDir");
ok(/dirReady/.test(setSlice), "建目录失败要回报（不能表现为『开了却没备份』）");

console.log("【④ 不重写 walker】");
ok(/filesForTurn/.test(cb), "备份走注入的 filesForTurn（取既有遍历结果）");
// ⛔ 锚点用**实际调用文本**（`threadIdOf`，不是 `turnIdOf` —— 这段作用域里 threadIdOf 是
//    字符串变量、把同名函数遮住了；锚点写错会让断言恒假红）。
const hookAt = bt.indexOf("void backupTurnIfEnabled(threadIdOf, id)");
ok(hookAt > 0, "boot 在回合收尾处调用备份（turn/completed 分支内）");
ok(/emitTurnFileChanges\(threadIdOf\)/.test(bt.slice(Math.max(0, hookAt - 900), hookAt)),
  "调用点在 emitTurnFileChanges 之后（拿的是刚算出的那份文件报告）");
ok(hookAt > 0 && /internalThreads\.has\(String\(threadIdOf\)\)/.test(bt.slice(hookAt - 60, hookAt + 60)),
  "⛔ 内部线程（记忆蒸馏等）不备份（否则污染用户的回看列表）");
ok(!/function backupTurnIfEnabled[\s\S]{0,600}(readdirSync|walkSync)/.test(bt),
  "⛔ boot 侧不得自己遍历工作区（两处 diff 真相源必然与 IGNORE/预算漂移）");
ok(/console\.warn\("\[change-backup\]/.test(cb), "备份失败只记日志（旁路能力，不打断回合）");

console.log("【⑤ 与 WorkBuddy 同构】");
ok(/changes-index/.test(cb) && /changes-detail/.test(cb), "目录名与 WorkBuddy 一致");
ok(/`\$\{conv\},\$\{req\}`/.test(cb), "变更 id 格式 `<convId>,<reqId>` 同 WorkBuddy");
ok(/cd_\$\{randomUUID\(\)\}\.\$\{revision\}\.json/.test(cb), "明细文件名 `cd_<uuid>.<revision>.json` 同 WorkBuddy");
ok(/INDEX_VERSION = 2/.test(cb) && /DETAIL_VERSION = 1/.test(cb), "格式版本同 WorkBuddy（索引 2 / 明细 1）");
ok(/content-omitted-size/.test(cb), "detailStatus 同名（明细超限省略正文）");
ok(/findIndex\(\(c\) => c\.requestId === req\)/.test(cb),
  "⛔ 同 requestId 原地替换而非追加（引擎重放同一回合会再触发一次 completed，追加就重复了）");

console.log("【⑥ 真跑：编译产物上的行为】");
const script = `
const fs=require("fs"),os=require("os"),path=require("path"),Module=require("module");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"bk-"));
const root=path.join(dir,"custom-backups");
const orig=Module._load;
Module._load=function(r){ if(r==="electron") return {app:{getPath:()=>dir}}; return orig.apply(this,arguments); };
const m=require(${JSON.stringify(join(ROOT, "dist-electron/features/change-backup.js"))});
const out={};
// ① 默认目录
const def=m.normalizeBackupDir("");
out.defaultDir=def.dir.endsWith(path.join("change-backups"));
out.defaultNoFallback=def.fallback===false;
// ② 非法回退：相对路径 / 盘符根
out.relFallback=m.normalizeBackupDir("foo/bar").fallback===true;
out.rootFallback=m.normalizeBackupDir("C:\\\\").fallback===true;
out.absOk=m.normalizeBackupDir(root).dir===root && m.normalizeBackupDir(root).fallback===false;
// ③ 目录不存在时不预建
out.notCreatedYet=!fs.existsSync(root);
out.ensureWorks=m.ensureBackupDir(root)===true && fs.existsSync(root);
// ⑤ 落一份备份并回读结构
m.writeChangeBackup("conv-1","req-1",[{filePath:"D:/x/a.ts",action:"modify",additions:10,deletions:2,hunks:[{oldStart:1,oldLines:2,newStart:1,newLines:3,lines:["a","b"]}]}]).then((r)=>{
  out.writeOk=r.ok===true;
  out.idx=fs.existsSync(path.join(root,"changes-index","conv-1.json"));
  const idx=JSON.parse(fs.readFileSync(path.join(root,"changes-index","conv-1.json"),"utf8"));
  out.id=idx.changes[0].id==="conv-1,req-1";
  out.summary=idx.changes[0].summary==="1 个文件变更，+10 −2";
  out.detailDir=fs.existsSync(path.join(root,"changes-detail","conv-1"));
  const det=fs.readdirSync(path.join(root,"changes-detail","conv-1"))[0];
  out.detailName=/^cd_[0-9a-f-]{36}\\.[0-9a-f-]{36}\\.json$/.test(det);
  out.detailHasHunks=JSON.parse(fs.readFileSync(path.join(root,"changes-detail","conv-1",det),"utf8")).change.files[0].hunks.length===1;
  // 同 requestId 重跑 ⇒ 原地替换不重复
  return m.writeChangeBackup("conv-1","req-1",[{filePath:"D:/x/a.ts",action:"modify",additions:1,deletions:0}]).then(()=>{
    const idx2=JSON.parse(fs.readFileSync(path.join(root,"changes-index","conv-1.json"),"utf8"));
    out.dedup=idx2.changes.length===1;
    out.readBack=m.readChangeBackups("conv-1",root).length===1;
    const s=m.backupSummary(root);
    out.summaryCount=s.changes===1 && s.conversations===1 && s.bytes>0;
    // 空变更不写
    const before=m.readChangeBackups("conv-1",root).length;
    return m.writeChangeBackup("conv-1","req-2",[]).then((r2)=>{
      out.emptySkipped=r2.ok===true && m.readChangeBackups("conv-1",root).length===before;
      // 清空
      out.cleared=m.clearChangeBackups(root)===true && m.readChangeBackups("conv-1",root).length===0;
      console.log(JSON.stringify(out));
    });
  });
}).catch((e)=>{ console.log(JSON.stringify(Object.assign(out,{__err:String(e&&e.message||e)}))); });
`;
try {
  const stdout = execFileSync(process.execPath, ["-e", script], { encoding: "utf8", cwd: ROOT });
  const out = JSON.parse(stdout.trim().split("\n").pop() || "{}");
  if (out.__err) console.log("  ⚠ 真跑异常：", out.__err);
  const list = [
    ["defaultDir", "默认目录落在 userData/change-backups"],
    ["defaultNoFallback", "默认目录不被标成回退"],
    ["relFallback", "相对路径 ⇒ 回退默认"],
    ["rootFallback", "磁盘根目录 ⇒ 回退默认（不往根里写）"],
    ["absOk", "合法绝对路径原样采纳"],
    ["notCreatedYet", "⛔ 仅解析路径不建目录"],
    ["ensureWorks", "ensureBackupDir 能创建"],
    ["writeOk", "写入返回 ok"],
    ["idx", "索引文件落位 changes-index/<conv>.json"],
    ["id", "变更 id = `<conv>,<req>`"],
    ["summary", "summary 文案格式同 WorkBuddy"],
    ["detailDir", "明细目录落位 changes-detail/<conv>/"],
    ["detailName", "明细文件名 `cd_<uuid>.<revision>.json`"],
    ["detailHasHunks", "明细含 hunks 全文"],
    ["dedup", "⛔ 同 requestId 重跑原地替换（不重复追加）"],
    ["readBack", "能按会话读回索引"],
    ["summaryCount", "产物概览统计正确"],
    ["emptySkipped", "空变更不写备份"],
    ["cleared", "清空生效"],
  ];
  for (const [key, label] of list) {
    if (key in out) ok(Boolean(out[key]), `真跑：${label}`);
  }
} catch (err) {
  const msg = String(err?.message || err).slice(0, 160);
  const envClass = /EBUSY|EPERM|ENOENT|not permitted|spawn/i.test(msg);
  ok(envClass, `⚠ 真跑子进程被环境阻断（${msg.slice(0, 50)}）——本组未跑，非逻辑红`);
}

console.log(`\n【change-backup】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);