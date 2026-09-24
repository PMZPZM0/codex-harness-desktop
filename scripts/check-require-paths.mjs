#!/usr/bin/env node
/**
 * 【96】编译产物相对路径断链守卫。
 *
 * 为什么要有它：tsc **不解析** require()/import() 的字面量路径（返回 any）⇒ 路径写错也能
 * build 通过；09-22 实测：voice-ipc 切分后子段里 require("../voice/voice-settings") 少上溯
 * 一层，tsc 0 错 / build EXIT=0 / 预检 0 红，**运行时才炸**（voice:settings-get 全哑，
 * 日志里是主进程 unhandled 而非 Uncaught ⇒ 连"无异常"冒烟的正则都抓不住）。
 *
 * 判据：dist-electron 每个 .js 里 `require("./..")` / `require("../..")` 必须能解析到
 * 产物树内的真实文件（.js/.json/index.js）。解析失败 = 断链 = 红。
 *
 * 用法：node scripts/check-require-paths.mjs   （已接进 npm run check）
 */
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url)) + "/..";
const DIST = join(ROOT, "dist-electron");

let okCount = 0, failCount = 0;
const ok = (m) => { okCount++; console.log("  ✓ " + m); };
const fail = (m) => { failCount++; console.log("  ✗ " + m); };

if (!existsSync(DIST)) {
  fail("dist-electron 不存在 —— 先 npm run build 再跑本守卫");
  process.exit(1);
}

const walk = (d) => {
  const out = [];
  (function w(x) {
    let it = [];
    try { it = readdirSync(x, { withFileTypes: true }); } catch { return; }
    for (const e of it) {
      const p = join(x, e.name);
      if (e.isDirectory()) w(p);
      else if (e.name.endsWith(".js")) out.push(p);
    }
  })(d);
  return out;
};

const resolveSpec = (fromFile, spec) => {
  const base = resolve(dirname(fromFile), spec);
  for (const c of [base, base + ".js", base + ".json", join(base, "index.js")]) {
    try { if (statSync(c).isFile()) return c; } catch { /* 继续 */ }
  }
  return null;
};

const files = walk(DIST);
let totalReq = 0;
const broken = new Map();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)) {
    totalReq++;
    if (!resolveSpec(f, m[1])) {
      const rel = relative(DIST, f).replace(/\\/g, "/");
      if (!broken.has(rel)) broken.set(rel, new Set());
      broken.get(rel).add(m[1]);
    }
  }
}

if (broken.size === 0) ok(`dist-electron ${files.length} 个 .js 的 ${totalReq} 处相对 require 全部可解析（无断链）`);
else {
  fail(`dist-electron 相对 require 断链 ${broken.size} 个文件（共 ${totalReq} 处相对 require）：`);
  let n = 0;
  for (const [rel, specs] of broken) {
    n++;
    if (n <= 12) console.log("      " + rel + "  → 缺 " + [...specs].join(", "));
    else if (n === 13) console.log("      …（余 " + (broken.size - 12) + " 个文件）");
  }
  console.log("\n  排查指引：这类错误 tsc 抓不到（require 字面量返回 any），");
  console.log("  多半是「把带 require(相对路径) 的语句搬进了深一层目录而没修正层数」。");
  console.log("  源码侧可用 .workbuddy/tmp/fix-require-paths.cjs 定位与修复。");
}

console.log("");
console.log(`【96】require 路径断链守卫：${failCount === 0 ? "通过" : "失败 " + failCount + " 项"}`);
process.exit(failCount === 0 ? 0 : 1);
