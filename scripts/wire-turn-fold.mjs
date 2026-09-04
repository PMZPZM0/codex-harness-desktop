// 把 App.tsx 里的状态机纯函数迁移到已存在的 src/lib/turn-fold.ts（原子接线）。
// 用法: node scripts/wire-turn-fold.mjs
// 安全: 所有锚点必须唯一命中且删除块包含预期的函数定义, 否则不落盘。
// 兼容异常行尾: 工作区曾出现 CRCRLF(\r\r\n), 用自适应 EOL 构造匹配串。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(root, "src", "App.tsx");
const modulePath = join(root, "src", "lib", "turn-fold.ts");

if (!existsSync(modulePath)) {
  console.error("FATAL: src/lib/turn-fold.ts missing");
  process.exit(1);
}

const text = readFileSync(appPath, "utf8");

// 自适应 EOL: 优先 CRCRLF 再 CRLF 最后 LF
const eol = text.includes("\r\r\n") ? "\r\r\n" : text.includes("\r\n") ? "\r\n" : "\n";
console.log("detected EOL:", JSON.stringify(eol));

let out = text;

// ── 1) 插入 import（锚: useFilePreview import 行之后）──
const importAnchor = 'import { useFilePreview } from "./hooks/useFilePreview";';
if (!out.includes(importAnchor)) {
  console.error("FATAL: import anchor not found");
  process.exit(1);
}
if (out.includes('from "./lib/turn-fold"')) {
  console.error("FATAL: turn-fold already imported");
  process.exit(1);
}
const importLine = `import { classifyUnit, buildSegments, foldItemStatus, computeFoldSummary, topToolGroup, isTurnRunning, normalizeLoadedThread, type FoldUnit } from "./lib/turn-fold";${eol}`;
out = out.replace(importAnchor, importAnchor + eol + importLine);

// ── 2) 删除本地 basename（模块内已有私有实现）── 用正则, EOL 自适应
const basenameRe = new RegExp(`function basename\\(value: string\\) \\{${eol}  return value\\.replace\\(\\/\\[\\\\\\\\\\/\\]\\+\\$\\/, ""\\)\\.split\\(\\/\\[\\\\\\\\\\/\\]\\/\\)\\.pop\\(\\) \\|\\| value;${eol}\\}${eol}${eol}`);
const basenameMatch = out.match(basenameRe);
if (!basenameMatch) {
  // 兜底: 只按函数签名到首个闭合括号删除
  console.error("FATAL: basename block not matched");
  process.exit(1);
}
out = out.replace(basenameRe, "");

// ── 3) 删除整个状态机纯函数块：从状态机注释行到 formatTimestamp 行之前 ──
const cmt = out.indexOf("// ═══ WorkBuddy assistant-fold 消息状态机");
const fmt = out.indexOf("function formatTimestamp", cmt);
if (cmt < 0 || fmt < 0 || fmt <= cmt) {
  console.error("FATAL: state-machine block anchors not found");
  process.exit(1);
}
const removed = out.slice(cmt, fmt);
for (const must of ["function classifyUnit", "function buildSegments", "function computeFoldSummary", "function normalizeLoadedThread", "function isTurnRunning", "function foldItemStatus", "function foldAtomOf"]) {
  if (!removed.includes(must)) {
    console.error(`FATAL: removed block missing "${must}" — range wrong, aborting`);
    process.exit(1);
  }
}
if (removed.includes("function formatTimestamp")) {
  console.error("FATAL: removed block overran into formatTimestamp — aborting");
  process.exit(1);
}
out = out.slice(0, cmt) + out.slice(fmt);

// ── 4) 验证：本地定义应已全部消失, import 已存在 ──
const leftover = ["function classifyUnit", "function buildSegments", "function computeFoldSummary", "function normalizeLoadedThread", "function isTurnRunning", "function foldItemStatus", "function foldAtomOf", "function truncText", "function basename", "const GROUP_TEXT"];
for (const name of leftover) {
  if (out.includes(name)) {
    console.error(`FATAL: local "${name}" still present`);
    process.exit(1);
  }
}
if (out.includes('from "./lib/turn-fold"') === false) {
  console.error("FATAL: turn-fold import missing after edit");
  process.exit(1);
}

writeFileSync(appPath, out, "utf8");
console.log("OK: wired turn-fold into App.tsx");
console.log("  removed block lines:", removed.split(eol).length);
