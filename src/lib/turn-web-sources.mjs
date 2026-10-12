/**
 * 回合网页来源提取（10-12，用户令「汇总消息右下角加一个当前回合搜索了哪些网站」）：
 * 从回合 items 里收集模型真正访问 / 检索过的 http(s) 网址，按**主机**去重、保首次出现序。
 *
 * 提取面（故意收窄，避免把代码输出里的每个链接都算成"访问过"）：
 *   · webSearch        —— query 原文 + 结果里出现的链接（搜索结果的落地页正是"搜了哪些网站"）；
 *   · mcpToolCall / dynamicToolCall —— **参数**里的 URL（browser_open / nuphus 浏览器工具的入参）；
 *   · commandExecution —— **命令行**里的 URL（playwright-cli open / curl / git clone 的目标）。
 *   ⛔ 不扫工具**输出**（除 webSearch 结果）—— npm/cargo 的日志里全是无关链接，全是噪音。
 *
 * 纯函数，node 可直接 import 跑真值表（守卫 12d）。
 */

const URL_RE = /https?:\/\/[^\s"'`<>()\[\]{}\\]+/gi;

function hostOf(raw) {
  try { return new URL(raw).hostname.toLowerCase(); } catch { return ""; }
}

/** 本机地址不算"网站"（模型探自己的网关/端口是常态）。 */
function isLocalHost(host) {
  return !host
    || host === "localhost"
    || /^127\./.test(host)
    || host === "0.0.0.0"
    || host === "[::1]"
    || host.endsWith(".local");
}

/** 收一个字符串面里的所有 URL（剪掉句尾标点 —— URL 后紧跟中文句号/括号是常态）。 */
function pushFrom(text, byHost) {
  for (const match of String(text ?? "").matchAll(URL_RE)) {
    const url = match[0].replace(/[.,;:!?)】》」'"。，；：！？]+$/, "");
    const host = hostOf(url);
    if (isLocalHost(host)) continue;
    if (!byHost.has(host)) byHost.set(host, { url, host });
  }
}

/** 一条 mcp / dynamic 工具调用的参数面（对象就序列化；字符串原样）。 */
function argText(item) {
  const args = item.arguments ?? item.input ?? item.params ?? item.args;
  if (args == null) return "";
  return typeof args === "string" ? args : JSON.stringify(args);
}

/**
 * @param turn {{ items?: Array<{ type: string, [k: string]: any }> }}
 * @returns Array<{ url: string, host: string }> —— 按 host 去重、首次出现序
 */
export function collectTurnWebSources(turn) {
  const byHost = new Map();
  for (const item of turn?.items ?? []) {
    if (item.type === "webSearch") {
      pushFrom(item.query, byHost);
      pushFrom(item.results, byHost);
    } else if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") {
      pushFrom(argText(item), byHost);
    } else if (item.type === "commandExecution") {
      pushFrom(item.command, byHost);
    }
  }
  return [...byHost.values()];
}
