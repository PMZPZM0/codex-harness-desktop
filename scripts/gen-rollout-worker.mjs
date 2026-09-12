// scripts/gen-rollout-worker.mjs
//
// 把 electron/rollout-worker.cjs 的源码内联成 TS 模块（electron/rollout-worker-source.ts）。
//
// 为什么要内联：打包后代码在 app.asar 里，而 `new Worker(文件路径)` 走 Node 的
// worker_threads（C++ 层读文件），**不经过 Electron 对 asar 的补丁** → 读不到。
// 项目里语音 worker 已用同一套办法（`new Worker(源码字符串, { eval: true })`）。
//
// 源文件保持可读可维护（.cjs，带注释、能被 lint/人读），构建时机械转成字符串常量。

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "electron", "rollout-worker.cjs");
const OUT = join(ROOT, "electron", "rollout-worker-source.ts");

const code = readFileSync(SRC, "utf8");

// 注意：必须用 String.raw 或在写入时正确转义反引号/反斜杠 —— 这里直接把源码塞进
// 模板字符串，所以先做最小必要转义（反引号与 ${）。worker 源码里两者都出现了。
const escaped = code.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

const banner = `// ⚠️ 本文件由 scripts/gen-rollout-worker.mjs 自动生成，请勿手改。
// 源文件：electron/rollout-worker.cjs（改那个，然后 npm run build:electron 会重新生成）
//
// 用途：把 worker 源码以字符串形式随编译产物一起走，供主进程用
// \\\`new Worker(源字符串, { eval: true })\\\` 启动 —— 绕开「asar 内 worker 读不到文件」。

`;

writeFileSync(OUT, `${banner}export const ROLLOUT_WORKER_SOURCE = \`${escaped}\`;\n`, "utf8");
console.log(`gen-rollout-worker: ${code.length} 字节 → electron/rollout-worker-source.ts`);
