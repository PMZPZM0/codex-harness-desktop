#!/usr/bin/env node
/**
 * 12cg-process-hygiene —— 「安装/卸载不许挂死主进程」的结构体检（11-22 用户：「能不能都认真检查一下」）
 *
 * 两天里同一类事故出现了三次，全部是**主进程被一个调用挂住**，而界面只表现为「卡住」：
 *   ① 卸载引擎：同步 `rmSync(recursive)` 删 8GB 目录 ⇒ 窗口「未响应」（11-22）
 *   ② 装 OpenMAIC：`pg_ctl start` 等 `close`，而 postgres 继承了管道 ⇒ close 永不触发（11-22）
 *   ③ 装语音引擎：`runCommand` 等 `close`，pip/uv 的构建子进程同样可能拖着管道（11-22 一并改）
 *
 * 这条守卫把「结论」变成「结构」，以后同类改动直接报红，不必再靠人肉逐个点：
 *   A. 所有**安装命令执行器**必须等 `exit`（不是 close），并且有「长时间无输出即中止」的看门狗；
 *   B. 拉起常驻服务的命令（pg_ctl 等）必须 `stdio: "ignore"`，否则 close 会被孙进程挂住；
 *   C. 用户可见的卸载通道里不许出现同步递归删除（必须走异步逐文件删 + 进度）。
 *
 * ⛔ 独立守卫（不进 `_ctx.mjs` 的 MODULES）⇒ 不计入 EXPECTED_CHECKS，与 12b* 系列同款。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks += 1;
  if (condition) console.log(`✓ ${message}`);
  else { fails += 1; console.log(`✗ ${message}`); }
};

/* ── A. 命令执行器：等 exit + 看门狗 ───────────────────────────────────── */
{
  const engines = codeOnly(read("electron/voice/external-engines.ts"));
  const runCommand = engines.slice(engines.indexOf("function runCommand("), engines.indexOf("function runCommand(") + 2600);
  ok(/child\.on\("exit", \(code\)/.test(runCommand) && !/child\.on\("close"/.test(runCommand),
    "语音引擎安装的 runCommand 等 exit（⛔ 等 close 会被继承管道的孙进程挂死）");
  ok(/10 \* 60_000/.test(runCommand) && /没有任何输出/.test(runCommand),
    "runCommand 有 10 分钟无输出看门狗（装依赖不会无限等）");
  ok(/stdio: \["ignore", "pipe", "pipe"\]/.test(runCommand),
    "runCommand 关掉 stdin（命令若等读 stdin 会永远挂住）");

  const openmaic = codeOnly(read("electron/openmaic-install.ts"));
  const step = openmaic.slice(openmaic.indexOf("function runOpenMaicStep("), openmaic.indexOf("function runOpenMaicStep(") + 2600);
  ok(/child\.on\("exit", \(code\)/.test(step) && !/child\.on\("close"/.test(step),
    "OpenMAIC 安装步骤等 exit");
  ok(/STEP_STALL_MS/.test(step) && /没有任何输出/.test(step),
    "OpenMAIC 安装步骤有 3 分钟无输出看门狗");
}

/* ── B. 拉起常驻服务的命令：stdio ignore ───────────────────────────────── */
{
  const openmaic = codeOnly(read("electron/openmaic-install.ts"));
  const pgctlSpawns = openmaic.split('spawn(path.join(').slice(1).filter((chunk) => chunk.includes("pg_ctl.exe"));
  const allIgnored = pgctlSpawns.every((chunk) => chunk.slice(0, 400).includes('stdio: "ignore"'));
  ok(pgctlSpawns.length >= 3 && allIgnored,
    `三处 pg_ctl 全部 stdio:"ignore"（实测 close 6 秒不触发，exit 才 326ms）`);
}

/* ── C. 用户可见的卸载通道：不许同步递归删 ─────────────────────────────── */
{
  const misc = codeOnly(read("electron/features/voice-ipc/03-voice-misc.ts"));
  const uninstall = misc.slice(misc.indexOf('ipcHost.handle("voice:models-uninstall"'), misc.indexOf('ipcHost.handle("voice:mic-permission"'));
  ok(!/rmSync\(/.test(uninstall) && /purgeDirWithProgress\(modelsRoot\(\)/.test(uninstall)
    && /releaseModelFiles\(\)/.test(uninstall),
    "voice:models-uninstall 走异步逐文件删 + 先释放 onnx 句柄（⛔ 不许同步递归删）");

  const engines = codeOnly(read("electron/voice/external-engines.ts"));
  const removeFn = engines.slice(engines.indexOf("export async function removeExternalEngine("), engines.indexOf("export function setExternalEngineEnabled("));
  ok(/export async function removeExternalEngine\(/.test(removeFn)
    && /purgeDirWithProgress\(dir/.test(removeFn) && !/rmSync\(join\(enginesRoot\(\), id\)/.test(removeFn),
    "removeExternalEngine 异步逐文件删（⛔ 8GB 目录同步删会把主进程卡到「未响应」）");
}

console.log(`\n【process-hygiene】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
if (fails) process.exitCode = 1;
