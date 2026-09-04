// 基线对照：临时去掉 developer_instructions 和 web_search，测输入 token 差异，之后恢复。
import { execSync } from "node:child_process";
import fs from "node:fs";

const configPath = "C:/Users/Administrator/AppData/Roaming/Codex Harness Desktop/codex-home/config.toml";
const original = fs.readFileSync(configPath, "utf8");
const stripped = original.replace(/developer_instructions = """[\s\S]*?"""/, "").replace("web_search = true", "web_search = false");
fs.writeFileSync(configPath, stripped, "utf8");
console.log("stripped. bytes:", stripped.length);

try {
  // 引擎会缓存 config?重启引擎最稳：杀掉 app-server 子进程，主进程会自动重启它
  // 这里直接跑测量脚本
  const out = execSync(`"${process.execPath}" scripts/measure-speed.mjs`, { encoding: "utf8", cwd: "D:/Codex Harness Desktop", timeout: 120000, env: { ...process.env } });
  console.log(out);
} finally {
  fs.writeFileSync(configPath, original, "utf8");
  console.log("config restored");
}
