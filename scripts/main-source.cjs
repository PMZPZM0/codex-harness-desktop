/**
 * 主进程源码并集（09-21 架构改造配套；09-22 更新口径）。
 *
 * electron/main.ts 正按域拆进 electron/features/**，其函数簇也拆进了 electron/main/**。
 * 「按文件内容写」的断言/探针若只读 main.ts（或只扫一层目录），每次搬域都会假红 ——
 * 那不是功能退化，是**代码搬走了**。判据语义不变：盯的是「这段内容存在于主进程源码面」，
 * 不关心它落在哪个文件、哪一层目录。
 *
 * ⛔ 与 check-preflight.mjs 的 readMainSource() 同口径（两处必须一致）。
 * ⛔ **必须递归**：09-22 实测只扫一层 ⇒ 拆进 electron/features/<域>/NN-*.ts 与 electron/main/*.ts
 *    的函数抠不到，`verify-image-plugin.mjs` 直接 AssertionError（sanity: 抠出的函数区间……）。
 * ⛔ 抠「两个标记之间的区间」时仍安全：并集按**路径排序**拼接，同一文件内的片段保持连续。
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function walk(dir, parts) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, parts);
    else if (/\.ts$/.test(e.name)) parts.push(fs.readFileSync(p, "utf8"));
  }
}

function readMainSource() {
  const parts = [fs.readFileSync(path.join(ROOT, "electron", "main.ts"), "utf8")];
  walk(path.join(ROOT, "electron", "features"), parts);
  walk(path.join(ROOT, "electron", "main"), parts);
  return parts.join("\n");
}

module.exports = { readMainSource };
