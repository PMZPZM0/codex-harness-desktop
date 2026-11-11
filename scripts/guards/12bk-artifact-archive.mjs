/**
 * 产物归档守卫（11-11）—— ⛔ 跑编译产物真跑输入输出，不是 grep 源码。
 *
 * 钉住的口径：日期-短名目录 / 语义名 / 同名 -r2 迭代 / 只复制不删 / manifest + 总台账 /
 * 路径不越界 / 网关工具与 IPC 通道都接上 / 迁移脚本默认 dry-run。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const distDir = join(ROOT, "dist-electron", "features");
const MODULE = join(distDir, "artifact-archive.js");
let checks = 0;
let fails = 0;
const ok = (cond, msg) => {
  checks++;
  console.log(`  ${cond ? "✓" : "✗"} 【artifact-archive】${msg}`);
  if (!cond) fails++;
};
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

if (!existsSync(MODULE)) {
  console.error("⛔ 编译产物缺失：先 npm run build");
  process.exit(1);
}
const mod = await import(pathToFileURL(MODULE).href);
const { archiveFiles, archiveDirName, artifactsRoot, isSemanticName, listArchives, nextAvailableName, normalizeTaskName } = mod;

const tmp = mkdtempSync(join(tmpdir(), "artifact-guard-"));
const src = join(tmp, "daily-1107.png");
writeFileSync(src, "PNG-PROBE");

/* ① 命名纯函数 */
ok(normalizeTaskName("推广/汇报:2026") === "推广汇报2026", "任务短名去掉路径与危险字符、空格转连字符");
ok(archiveDirName(new Date(2026, 10, 11), "推广 汇报") === "20261111-推广-汇报", "目录名 = YYYYMMDD-任务短名（固定日期真跑）");
ok(!archiveDirName(Date.now(), "../../escape").includes(".."), "⛔ 任务名里的 ../ 不能让目录跑出 artifacts 根");
ok(isSemanticName("daily-1107.png") && isSemanticName("费比口径-r2.md"), "内容语义名（含迭代后缀）被认出");
ok(!isSemanticName("a1.png") && !isSemanticName("未命名.png") && !isSemanticName("1794296622177.png"), "噪声名（a1 / 未命名 / 纯时间戳）被识别出来");

/* ② 同名迭代后缀 */
const dir = join(tmp, "probe-dir");
const { mkdirSync } = await import("node:fs");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "x.png"), "");
ok(nextAvailableName(dir, "x.png") === "x-r2.png", "同名已存在 ⇒ 自动 -r2（⛔ 不覆盖旧版）");
writeFileSync(join(dir, "x-r2.png"), "");
ok(nextAvailableName(dir, "x.png") === "x-r3.png", "再归档一版 ⇒ -r3");

/* ③ 真落盘往返 */
const first = await archiveFiles(tmp, {
  files: [{ path: src }], task: "推广汇报", at: new Date(2026, 10, 11).getTime(),
  source: "守卫", note: "验收",
});
ok(first.ok === true && first.dir === "20261111-推广汇报", "archiveFiles 真落盘到日期-短名目录");
ok(existsSync(src), "⛔ 原文件保留（只复制不移动/删除）");
const target = join(artifactsRoot(tmp), "20261111-推广汇报");
ok(existsSync(join(target, "daily-1107.png")), "产物文件按内容语义名落盘");
const manifest = JSON.parse(readFileSync(join(target, "_manifest.json"), "utf8"));
ok(manifest.task === "推广汇报" && manifest.files.length === 1, "目录内 _manifest.json 记任务 + 文件清单");
ok(readFileSync(join(artifactsRoot(tmp), "index.jsonl"), "utf8").includes("20261111-推广汇报"), "根 index.jsonl 总台账追加一行");

const second = await archiveFiles(tmp, {
  files: [{ path: src }], task: "推广汇报", at: new Date(2026, 10, 11).getTime(),
});
ok(second.ok === true && second.saved?.[0]?.name === "daily-1107-r2.png", "同任务再归档 ⇒ 迭代后缀，不覆盖第一版");
const rows = listArchives(tmp, 10);
ok(rows.length === 1 && rows[0].files.length === 2, "listArchives 按目录聚合（两版算一次任务）");

const missing = await archiveFiles(tmp, { files: [{ path: join(tmp, "不存在.png") }], task: "x" });
ok(missing.ok === false && /没有任何文件归档成功|文件不存在/.test(String(missing.error)), "源文件不存在 ⇒ 明确报错，不建空目录当成功");

/* ④ 接线（静态：少了任何一处功能就静默失效） */
const core = read("electron/features/dispatch-core.ts");
const rpc = read("electron/features/dispatch-rpc.ts");
const manifestSrc = read("electron/ipc-channels.manifest.json");
const registry = read("electron/ipc-registry.ts");
const dataPages = read("src/features/app-view/AppView/08-settings-sheet/01-settings-layout/pages/data.tsx");
const talk = read("electron/features/group-talk/03-talk.ts");
const migrate = read("scripts/artifacts-migrate.mjs");
ok(/name: "artifact_archive"/.test(core) && /name: "artifact_list"/.test(core), "网关能力清单暴露归档 / 查清单两个工具");
ok(/runArtifactTool/.test(rpc), "执行端分派到 runArtifactTool（⛔ 只加 schema 不落库 = 静默丢参）");
ok(/artifact:list/.test(manifestSrc) && /prefix: "artifact"/.test(registry), "IPC 通道 + 域登记，前端能读清单");
ok(/ArtifactPanel/.test(dataPages), "设置页注册表挂上产物归档面板");
ok(/artifacts\/YYYYMMDD/.test(talk), "群聊提示词仍写明产物落盘约定（工具与约定同口径）");
ok(/const apply = argv\.includes\("--apply"\)/.test(migrate) && /未写任何文件/.test(migrate), "⛔ 迁移脚本默认 dry-run，必须 --apply 才写");

rmSync(tmp, { recursive: true, force: true });
console.log(`【artifact-archive】${checks - fails}/${checks} 通过`);
if (fails) { console.error(`\n✗ ${fails} 项未通过`); process.exit(1); }
