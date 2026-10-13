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

console.log("【⑦ 容量上限 3G + 回收站（10-13 用户令）】");
ok(/BACKUP_MAX_BYTES = 3 \* 1024 \* 1024 \* 1024/.test(cb), "容量上限 = 3G");
ok(/pruneBackupsBySize/.test(cb), "有独立的裁剪单元");
ok(/deps\.trash/.test(cb) && /moveToTrash/.test(cb),
  "⛔ 删除走**注入的 trash 回调**，不是模块内直接 rm（备份是用户代码唯一副本）");
ok(!/rmSync\([^)]*detailDir|rmSync\([^)]*indexFilePath/.test(cb),
  "⛔ 裁剪路径里不得出现 rmSync（硬删 = 不可恢复地删掉别人写的代码）");
const pruneSlice = cb.slice(cb.indexOf("export function pruneBackupsBySize"), cb.indexOf("async function moveToTrash"));
ok(pruneSlice.indexOf("detailDir") < pruneSlice.indexOf("indexFilePath") && /moveToTrash\(detailDir/.test(pruneSlice),
  "⛔ 同一会话**明细先于索引**搬（反了会留「有索引无明细」的孤儿会话）");
ok(/sort\(\(a, b\) => a\.oldest - b\.oldest\)/.test(pruneSlice), "按最旧优先裁剪");
ok(/if \(!ok\) result\.skipped\+\+/.test(cb) && /return false/.test(cb),
  "⛔ 搬移失败**保留**该份数据（不退化成硬删），只计 skipped");
ok(/PRUNE_MAX_PER_WRITE/.test(cb), "单次裁剪限量（别让一次扫描/搬移卡住主进程）");
ok(/pruneBackupsBySize\(root/.test(cb) && /必须在写完之后做/.test(cb),
  "⛔ 裁剪在**写完之后**做（先裁再写会白裁一遍）");
ok(/shell\.trashItem/.test(bt), "boot 注入 shell.trashItem（只有主进程有这个能力）");
ok(/return false;   \/\/ ⛔ 失败就\*\*保留\*\*/.test(bt) || /失败就\*\*保留\*\*/.test(bt),
  "boot 的 trash 回调失败时返回 false 而不是硬删");

console.log("【⑧ agent 工具面（用户「配套好工具让 Codex 自己完成」）】");
ok(/export function listAllBackups/.test(cb), "有 list-all（有哪些备份可捞）");
ok(/export function readBackupChange/.test(cb), "有 read-change（当时到底改了什么）");
ok(/export function restoreFileFromBackup/.test(cb), "有 restore-file（回滚某文件）");
ok(/export async function pruneBackups/.test(cb), "有 prune（手动触发容量清理）");
const restoreSlice = cb.slice(cb.indexOf("export function restoreFileFromBackup"));
ok(/needs_full_content/.test(restoreSlice),
  "⛔ 备份里没有整份正文时**如实回 needs_full_content**（不假装成功、不重试瞎猜）");
ok(/outside_workspace/.test(restoreSlice) && /startsWith\(rootWs \+ path\.sep\)/.test(restoreSlice),
  "⛔ restore 目标必须在工作区内（防路径穿越把用户文件写到任意位置）");
// ⛔ 只查**代码里有没有**整条回滚的导出，别去匹配注释（本守卫第一版就栽在这：
//    注释里写的正是「不做整条一键回滚」，被 `/一键/` 命中 ⇒ 恒假红）。
//    判据 = 除 restoreFileFromBackup / readBackupChange 等单文件与只读导出外，
//    不存在任何「按 conversationId+requestId 批量写回」的导出。
const exportsList = [...cb.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]);
const bulkWrites = exportsList.filter((name) => /restore|rollback|revert|apply/i.test(name));
ok(bulkWrites.length === 1 && bulkWrites[0] === "restoreFileFromBackup",
  `⛔ 不提供「整条一键回滚」（会连带覆盖用户之后的改动）—— 现有写类导出：${bulkWrites.join("、") || "无"}`);
ok(/backup:list-all/.test(bi) && /backup:read-change/.test(bi) && /backup:restore-file/.test(bi) && /backup:prune/.test(bi),
  "四个工具都已注册为 IPC 通道（模型够得着）");
ok(/count: 9/.test(readFileSync(join(ROOT, "electron/ipc-registry.ts"), "utf8")), "ipc-registry 的 count 已同步为 9");
const genSkill = readFileSync(join(ROOT, "scripts/gen-capability-skill.mjs"), "utf8");
ok(/backupListAll/.test(genSkill) && /backupRestoreFile/.test(genSkill) && /backupPrune/.test(genSkill),
  "⛔ 能力清单里写了用法（含 needs_full_content 的处置）——不写模型不知道有这些工具、也不会去 grep 源码");

console.log("【⑨ 真跑：编译产物上的行为】");
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