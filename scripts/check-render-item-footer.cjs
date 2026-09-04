#!/usr/bin/env node
// 校验 TurnFoldStream 内 renderItem 调用的 footer 隐藏策略统一：
// 所有 renderItem 对 agentMessage 必须显式传 true（或传 hideFinalFooter prop，外层恒 true），
// 否则会与 TurnView 外层 turnFinished && finalAgent 渲染的 MessageFooter 双排。
//
// 铁律：renderItem 的 hideFooter 参数，undefined/false 都视为"显示"（renderItem 内部
// `hideFooter || undefined` 处理）—— 错传 → inner+outer 双排。
//
// 之所以写成自动化门禁而不靠人守：8 处 renderItem 调用，上一次漏了 2 处改到流式 foldable
// 特殊分支（lead/tail），造成用户截图里"哈喽" 消息下面两排操作栏。见日志 2026-09-01。

const fs = require("fs");
const path = require("path");

// 默认扫 src/App.tsx；传文件路径可扫任意文件（自检/反向测试用）
const FILE = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "../src/App.tsx");
const src = fs.readFileSync(FILE, "utf-8").replace(/\r\n/g, "\n");

// 行号映射：原文件 line N 是 srcLines[N-1]（srcLines 与原文件去掉行内 CRLF 后等价）
const srcLines = src.split("\n");
const FILE_LABEL = path.relative(process.cwd(), FILE) || FILE;
let problems = 0;
const callCount = (src.match(/\brenderItem\s*\(/g) || []).length;

// \b 防 renderItemResult 等长名误识别（renderItem 必须为独立 token）
const CALLEE_REGEX = /\brenderItem\s*\(/g;
let match;
while ((match = CALLEE_REGEX.exec(src)) !== null) {
  const openParenIdx = CALLEE_REGEX.lastIndex - 1; // '(' 的位置
  // 找到第二个参数起始（跳过第一个参数 + ',' + 空白）
  let i = openParenIdx + 1;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    i++;
  }
  // 现在 src[i-1] 闭合的是 renderItem 内层（深度为 0 时这里 ')'）
  // 但我们要的是参数分隔符 ',' 在最外层。重新扫描。
  i = openParenIdx + 1;
  let argDepth = 1;  // 已经包在第一个 '()' 内
  let commaIdx = -1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "(" || ch === "[" || ch === "{") argDepth++;
    else if (ch === ")" || ch === "]" || ch === "}") argDepth--;
    else if (ch === "," && argDepth === 1) { commaIdx = i; break; }
    if (ch === ")" && argDepth === 0) break;
    i++;
  }
  if (commaIdx === -1) continue; // 单参数调用（不该出现）

  // 第二个参数：[commaIdx+1, renderMvp结束的 ')'）
  let argStart = commaIdx + 1;
  while (argStart < src.length && /\s/.test(src[argStart])) argStart++;
  let argEnd = openParenIdx + 1;
  let scanDepth = 1;
  while (argEnd < src.length) {
    const ch = src[argEnd];
    if (ch === "(" || ch === "[" || ch === "{") scanDepth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (scanDepth === 1) break; // renderItem 闭合
      scanDepth--;
    }
    argEnd++;
  }
  const arg = src.substring(argStart, argEnd).trim();

  // 行号：从 src 开头到 argStart 的换行数 + 1
  const lineNum = src.substring(0, argStart).split("\n").length;

  // 合规形态：① item.type === "agentMessage" ? true : undefined
  //           ② 字面量 true（finalAgent 单独渲染时硬编码隐藏 footer）
  // 不合规：undefined / false / hideFinalFooter 等→ 都会被 inner 归一化为"显示"，双排。
  const isTriple =
    /item\.type\s*===\s*["']agentMessage["']\s*\?\s*true\s*:\s*undefined/.test(arg);
  const isLiteralTrue = arg === "true";

  if (isTriple || isLiteralTrue) continue;

  problems++;
  const preview = arg.length > 90 ? arg.slice(0, 90) + "..." : arg;
  console.error(`\u2717 ${FILE_LABEL}:${lineNum}`);
  console.error(`    renderItem(..., ${preview})`);
  console.error(`    \u671f\u671b: agentMessage ? true : undefined  \u6216  true`);
}

if (problems === 0) {
  console.log(`\u2713 renderItem footer \u7edf\u4e00\u6027: ${callCount} \u5904\u8c03\u7528\u5168\u90e8\u5408\u89c4`);
  process.exit(0);
} else {
  console.error(`\n\u2717 ${problems}\u5904 renderItem \u4f20\u53c2\u4e0d\u5408\u89c4\uff0c\u4f1a\u5bfc\u81f4 inner+outer \u53cc\u6392 MessageFooter`);
  process.exit(1);
}
