// nuphus-call：nuphus-mcp 的按需命令行桥。
// 用法：nuphus-call <tool> [key=value ...]   例：nuphus-call desktop_screenshot path=D:\s.png
// 不走 MCP 常驻连接——引擎只在真正需要操作桌面/浏览器时才调用，
// 35 个工具 schema 不占模型上下文，回复速度与未装自动化时一致。
import { spawn } from "node:child_process";
const exe = process.env.NUPHUS_BIN || "";
if (!exe) {
  console.error("nuphus-call: missing NUPHUS_BIN; start from the application toolchain");
  process.exit(2);
}

const tool = process.argv[2];
const args = {};
for (const raw of process.argv.slice(3)) {
  const eq = raw.indexOf("=");
  if (eq <= 0) continue;
  const key = raw.slice(0, eq);
  let value = raw.slice(eq + 1);
  // JSON 值（对象/数组/布尔/数字）原样解析，其余按字符串
  try { value = JSON.parse(value); } catch { /* 字符串 */ }
  args[key] = value;
}

// 与 MCP 等价的 strict-confirm 确认位：写操作需要 confirm=true
const payload = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "nuphus-call", version: "0.1.0" } } };
const call = tool
  ? { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }
  : { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

const child = spawn(exe, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
let buffer = "";
const done = (code, text) => {
  child.kill();
  process.stderr.write(text);
  process.exit(code);
};
child.stderr.on("data", (c) => process.stderr.write(c));
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.id === 2) {
      const result = message.result ?? { isError: true, content: [{ type: "text", text: JSON.stringify(message.error ?? message) }] };
      // 把 MCP content 摊平成可读输出
      const text = result.tools ? JSON.stringify(result.tools, null, 2) : (result.content ?? []).map((part) => part.type === "text" ? part.text : `[${part.type}]`).join("\n");
      process.stdout.write(text + "\n");
      child.kill();
      process.exit(result.isError ? 1 : 0);
    }
    if (message.id === 1) child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n" + JSON.stringify(call) + "\n");
  }
});
child.on("error", (error) => done(1, `nuphus-call: ${error.message}\n`));
child.stdin.on("error", (error) => done(1, `nuphus-call: ${error.message}\n`));
child.on("exit", (code) => done(code || 1, "nuphus-call: server exited before responding\n"));
setTimeout(() => done(1, "nuphus-call: timeout after 120s\n"), 120_000);
child.stdin.write(JSON.stringify(payload) + "\n");
