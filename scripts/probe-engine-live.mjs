// 用真实 codex.exe + 应用生成的 config.toml 直接跑一次性对话，验证引擎与供应商链路
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";

const codexHome = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Codex Harness Desktop", "codex-home");
const exe = path.join("node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");

const child = spawn(path.resolve(exe), ["exec", "--skip-git-repo-check", "-C", codexHome, "Reply with exactly OK."], {
  env: { ...process.env, CODEX_HOME: codexHome },
  stdio: ["ignore", "pipe", "pipe"],
});
let out = "", err = "";
child.stdout.on("data", (c) => (out += c));
child.stderr.on("data", (c) => (err += c));
const timer = setTimeout(() => { console.log("TIMEOUT after 90s"); child.kill(); }, 90000);
child.on("exit", (code) => {
  clearTimeout(timer);
  console.log("exit code:", code);
  console.log("stdout tail:\n" + out.slice(-1500));
  if (err) console.log("stderr tail:\n" + err.slice(-800));
});
