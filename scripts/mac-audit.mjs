#!/usr/bin/env node
// mac 适配审计（发版清单第 0 步，用户 2026-09-18 定为每次必做）
//
//   node scripts/mac-audit.mjs [上一版tag] [目标ref]
//   默认：上一版 tag = 最近的 v* tag；目标 ref = HEAD
//
// 做什么：对 `git diff <上一版>..<目标> -- electron/ src/ scripts/ build/` 的**新增行**
// 扫平台敏感模式，按模式分组列出命中，并标注可自动判断的"大概率无害"，供人逐条判读。
//
// ⛔ 为什么必须"每次发版"跑：历史上真缺口都是新增行里的（写死 `\codex-home\skills`、
//    install-automation 只认 Windows 解压器），而不是老代码。
//
// ⛔⛔ 为什么脚本自带"正则自证"：0 命中与"正则写错了"在输出上**完全一样**。
//    2026-09-18 实测：Windows 绝对路径那条正则写成 `[A-Za-z]:\\\\`（匹配单反斜杠），
//    而源码里的路径字面量是**双反斜杠**（`"C:\\Users\\..."`）⇒ 它对源码形态永远不匹配，
//    于是报出"0 命中"，看起来像"审计通过"。**采信 0 之前必须先证明正则能命中。**
//    本脚本因此每次先用内置人造样本验每条正则，任一条不符合预期就直接失败退出。
//
// ⛔ 判读提醒：命中不等于缺口。以下三类**通常无害**，但要人看一眼确认：
//    ① 平台门控内（`process.platform === "win32"` 分支里的 .exe / PowerShell 调用）；
//    ② scripts/ 下的**断言夹具**（测试用的路径样本，纯字符串处理，不碰文件系统）；
//    ③ 文案命中（帮助文本里写「Windows」等）。
//    真正要修的是"跨平台代码路径里写死某个平台的东西"。

import { execFileSync } from "node:child_process";

const GIT = process.env.GIT_BIN || "git";
const git = (args) => execFileSync(GIT, args, { encoding: "utf8", maxBuffer: 200 * 1024 * 1024 });

// ── 平台敏感模式 ────────────────────────────────────────────────────────────
// `samples`: [应当命中的样本, ...] / `negatives`: [不应当命中的样本, ...]（自证用）
// ⛔ 样本必须写成"源码里的字面形态"（含转义），这是本脚本存在的意义。
const PATTERNS = [
  {
    id: "exe",
    re: /\.exe\b/i,
    note: "Windows 可执行文件；mac 上若被当成工具路径写死则失效",
    samples: ['spawn("python.exe")', 'const bin = tools + "\\\\7z.exe";'],
    negatives: ["const exe = executable;", "textContent = 'execute'"],
  },
  {
    id: "win32",
    re: /win32/,
    note: "平台判断；在门控里无害，写死则 mac 走不到分支",
    samples: ['if (process.platform === "win32") {', "const isWin = platform === 'win32';"],
    negatives: ['if (process.platform === "darwin") {'],
  },
  {
    id: "darwin",
    re: /darwin/,
    note: "mac 平台判断 —— 反向检查：是否只判了 win32 而漏了 darwin",
    samples: ['process.platform === "darwin"'],
    negatives: ["const d = darkwin;"],
  },
  {
    id: "ctrl-key",
    re: /Ctrl\+|ctrlKey/,
    note: "Windows 快捷键；mac 习惯是 Cmd —— 但 `ctrlKey || metaKey` 是正确的跨平台写法",
    samples: ['if (event.ctrlKey || event.metaKey) {', '"Ctrl+S 保存"'],
    negatives: ["if (event.metaKey) {"],
  },
  {
    id: "backslash",
    re: /\\\\[a-zA-Z]|\\\\[\\/]/,
    note: "源码里的反斜杠路径（含断言夹具）—— 展示路径写死反斜杠会让 mac 显示成 /a\\b\\c",
    // 正例取真实缺口形态：绝对路径、以及历史上真出过的 `\\codex-home\\skills` 写法
    samples: ['const p = "C:\\\\Users\\\\me\\\\x";', 'const skillsPath = "\\\\codex-home\\\\skills";'],
    negatives: ["const re = /[ \\t]+/;", "const t = '\\t';"],
  },
  {
    id: "winpath",
    re: /[A-Za-z]:[\\/]{1,2}(?:Users|Windows|Program|AppData)/,
    note: "Windows 绝对路径硬编码（跨平台代码里出现即为真缺口）",
    // ⛔ 这两条样本要覆盖"源码转义形态"与"运行时形态"——早先只测后者，正则错了也没发现
    samples: ['const p = "C:\\\\Users\\\\Administrator\\\\x";', 'open("D:\\\\Program Files\\\\app")', "C:\\Users\\me\\x"],
    negatives: ['const drive = "C:";', "src/lib/foo.ts"],
  },
  {
    id: "powershell",
    re: /powershell|pwsh/i,
    note: "PowerShell 调用；mac 没有（门控内无害）",
    samples: ['spawn("powershell", ["-c", cmd])', 'const shell = "pwsh";'],
    negatives: ["const notAShell = true;"],
  },
  {
    id: "appdata",
    re: /APPDATA|USERPROFILE|LOCALAPPDATA/,
    note: "Windows 环境变量；mac 用 HOME（多数情况应走 app.getPath）",
    samples: ['const dir = process.env.APPDATA;', "process.env['LOCALAPPDATA']"],
    negatives: ["const data = appData;"],
  },
];

// ── 第一步：正则自证（硬门禁，不通过就不给审计结论）─────────────────────────
function selfCheck() {
  const bad = [];
  for (const p of PATTERNS) {
    for (const s of p.samples) if (!p.re.test(s)) bad.push(`[${p.id}] 应命中却未命中：${JSON.stringify(s)}`);
    for (const s of p.negatives || []) if (p.re.test(s)) bad.push(`[${p.id}] 不应命中却命中：${JSON.stringify(s)}`);
  }
  return bad;
}

// ── 第二步：取 diff 的新增行 ────────────────────────────────────────────────
function addedLines(base, target) {
  const diff = git(["diff", "-U0", `${base}..${target}`, "--", "electron/", "src/", "scripts/", "build/"]);
  const rows = [];
  let file = "";
  let line = 0;
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("+++ b/")) { file = raw.slice(6); continue; }
    const m = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) { line = Number(m[1]); continue; }
    if (!raw.startsWith("+") || raw.startsWith("+++")) continue;
    rows.push({ file, line, text: raw.slice(1) });
    line++;
  }
  return { rows, stat: git(["diff", "--stat", `${base}..${target}`, "--", "electron/", "src/", "scripts/", "build/"]) };
}

// ── 主流程 ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let base = args[0];
const target = args[1] || "HEAD";
if (!base) {
  // 默认取最近的 v* tag 作为上一版
  const tags = git(["tag", "--sort=-creatordate", "--list", "v*"]).split(/\r?\n/).filter(Boolean);
  base = tags[0];
  if (!base) { console.error("找不到任何 v* tag，请显式传入上一版 tag"); process.exit(2); }
  console.error(`（未指定上一版，自动取最近的 tag：${base}）`);
}

const bad = selfCheck();
console.log("=== 步骤 1／2：正则自证 ===");
if (bad.length) {
  console.log("✗ 扫描器自身有问题，本次审计结论不可采信：");
  for (const b of bad) console.log("   " + b);
  console.log("\n请先修正则再跑（改 PATTERNS 里的 re / samples）。");
  process.exit(1);
}
console.log(`✓ ${PATTERNS.length} 条正则全部通过人造样本自证（应命中的命中、不应命中的不命中）`);
console.log("   → 因此下面出现的 0 命中是「真的没有」，不是「正则坏了」。");
console.log("");

console.log(`=== 步骤 2／2：审计 ${base}..${target} 的新增行 ===`);
const { rows, stat } = addedLines(base, target);
console.log("--- 改动规模 ---");
console.log(stat.split(/\r?\n/).slice(0, 45).join("\n") || "(无改动)");
console.log("");

const byId = {};
for (const p of PATTERNS) byId[p.id] = [];
for (const r of rows) for (const p of PATTERNS) if (p.re.test(r.text)) byId[p.id].push(r);

let total = 0;
console.log("--- 按模式分组（逐条判读） ---");
for (const p of PATTERNS) {
  const list = byId[p.id];
  total += list.length;
  console.log("");
  console.log(`### [${p.id}] ${list.length} 条 —— ${p.note}`);
  for (const r of list.slice(0, 50)) {
    // 自动标注"大概率无害"：断言夹具（scripts/ 下）或平台门控行
    const inTests = /^scripts\//.test(r.file);
    const looksGated = /win32|darwin|process\.platform|isMac|isWindows/.test(r.text);
    const flag = inTests ? "〔多半是断言夹具〕" : looksGated ? "〔疑似平台门控，确认分支完整〕" : "〔需人工确认〕";
    console.log(`  ${r.file}:${r.line} ${flag}`);
    console.log(`      ${r.text.trim().slice(0, 170)}`);
  }
  if (list.length > 50) console.log(`  …（还有 ${list.length - 50} 条）`);
}
console.log("");
console.log(`=== 汇总：命中 ${total} 条（分布在 ${PATTERNS.filter((p) => byId[p.id].length).map((p) => p.id).join(", ") || "无"}） ===`);
console.log("判读口径：平台门控内 / 断言夹具 / 文案命中 → 通常无害；跨平台代码里写死某平台的东西 → 真缺口，必须修。");
console.log("结论请写进发版说明的 macOS 段（含「命中数 + 逐条判读」，以及 0 命中时的自证说明）。");
