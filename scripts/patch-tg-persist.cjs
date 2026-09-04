// Telegram 持久化 + resume（行级 CRLF 安全）
const fs = require("fs");
let s = fs.readFileSync("electron/telegram-gateway.ts", "utf8");
const EOL = s.includes("\r\n") ? "\r\n" : "\n";
const lines = s.split(/\r?\n/);

if (!s.includes("stateFile")) {
  // import 头
  lines.unshift('import path from "node:path";', 'import os from "node:os";', 'import fs from "node:fs";');
  // stateFile 常量
  const apiIdx = lines.findIndex((l) => l.includes('const API = "https://api.telegram.org"'));
  lines.splice(apiIdx + 1, 0, 'const stateFile = path.join(process.env.CODEX_HARNESS_USER_DATA || path.join(os.homedir(), "AppData", "Roaming", "Codex Harness Desktop"), "telegram-account.json");');
}

// connect 成功后持久化
if (!s.includes("fs.writeFileSync(stateFile")) {
  const logIdx = lines.findIndex((l) => l.includes("Telegram 机器人 @"));
  lines.splice(logIdx + 1, 0, '    try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify({ token: clean, username: me.result.username }, null, 2)); } catch { /* 持久化失败不阻塞 */ }');
}

// resume 方法
if (!s.includes("async resume()")) {
  const stopIdx = lines.findIndex((l) => l.trim().startsWith("stop()"));
  lines.splice(stopIdx, 0,
    "  /** 重启恢复：有持久化 token 自动重连 */",
    "  async resume() {",
    "    try {",
    '      const raw = JSON.parse(fs.readFileSync(stateFile, "utf8"));',
    "      if (raw.token) return await this.connect(raw.token);",
    "    } catch { /* 未配置 */ }",
    "    return false;",
    "  }",
    "");
}

fs.writeFileSync("electron/telegram-gateway.ts", lines.join(EOL));
const check = fs.readFileSync("electron/telegram-gateway.ts", "utf8");
console.log("stateFile:", check.includes("stateFile"), "| resume:", check.includes("async resume()"));
