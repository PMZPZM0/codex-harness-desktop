#!/usr/bin/env node
/**
 * 命令行版的"语音模型按需下载"。
 * 等价于在 设置 → 开发工具 → 语音模型 里点「下载模型」：
 * 把三件套（asr + vad + tts）按 `electron/voice/model-manifest.ts` 的清单
 * 下载到 `<userData>/voice-models/` 并校验 SHA256。
 *
 * 用法：
 *   node scripts/install-voice-models.cjs
 *   # 指定别的根目录（默认 = <APPDATA 或 HOME>/Codex Harness Desktop/voice-models）：
 *   CODEX_HARNESS_VOICE_MODELS=/path/to/root node scripts/install-voice-models.cjs
 *
 * 退出码：0 = 全部成功；1 = 任一失败。
 */
"use strict";

const path = require("node:path");
const os = require("node:os");

// 强制禁掉宿主注入的 NODE_OPTIONS / ELECTRON_RUN_AS_NODE 等——同 e2e harness
delete process.env.NODE_OPTIONS;
delete process.env.ELECTRON_RUN_AS_NODE;

const MODELS = path.join(
  process.env.CODEX_HARNESS_VOICE_MODELS ||
    (process.platform === "win32" ? path.join(process.env.APPDATA || os.homedir(), "Codex Harness Desktop") : path.join(os.homedir(), "Library", "Application Support", "Codex Harness Desktop")),
  "voice-models"
);

async function main() {
  // 走已编译产物（避免 require TS）；如果还没有 dist-electron 就用 src（node 22 不支持 TS，需自行 tsc）
  const root = path.resolve(__dirname, "..");
  const compiled = path.join(root, "dist-electron", "voice", "model-store.js");
  const fallback = path.join(root, "electron", "voice", "model-store.ts");
  const manifestCompiled = path.join(root, "dist-electron", "voice", "model-manifest.js");
  let storeMod, manifestMod;
  try {
    storeMod = require(compiled);
    manifestMod = require(manifestCompiled);
  } catch (e) {
    console.error("[voice-models] 需要先 `npm run build:electron`（编译产物没找到：" + compiled + "）");
    process.exit(2);
  }
  const { ensureRepo, voiceModelsStatus } = storeMod;
  const allRepos = manifestMod.ALL_VOICE_REPOS || Object.values(manifestMod).filter((x) => x && x.repo && Array.isArray(x.files));
  if (!allRepos || !allRepos.length) {
    console.error("[voice-models] manifest 没解析到仓库清单");
    process.exit(2);
  }

  console.log("[voice-models] 目标目录：" + MODELS);
  const status = await voiceModelsStatus(MODELS, allRepos);
  console.log(`[voice-models] 现状：${status.ready}/${status.total}（${(status.bytes / 1024 / 1024).toFixed(1)} MB）`);

  let failed = 0;
  for (const repo of allRepos) {
    console.log(`[voice-models] 仓库 ${repo.repo}（${repo.files.length} 个文件）…`);
    const fails = await ensureRepo(MODELS, repo, (p) => {
      process.stdout.write(`  ${p.file} ${p.percent >= 0 ? p.percent + "%" : "…"}\r`);
    });
    process.stdout.write("\n");
    if (fails.length) {
      failed++;
      for (const f of fails) console.log(`  ✗ ${f}`);
    } else {
      console.log(`  ✓ 完成`);
    }
  }
  if (failed) {
    console.error(`[voice-models] ${failed} 个仓库失败`);
    process.exit(1);
  }
  console.log("[voice-models] 全部就绪 ✓");
}

main().catch((error) => {
  console.error("[voice-models] 异常退出：" + (error?.message ?? error));
  process.exit(1);
});