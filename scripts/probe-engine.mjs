// 直接探测 Codex 引擎二进制 + 真实供应商连通性，与 UI 无关
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const codexHome = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Codex Harness Desktop", "codex-home");
const config = await fs.readFile(path.join(codexHome, "config.toml"), "utf8").catch(() => "");
const baseUrl = config.match(/base_url = "([^"]+)"/)?.[1] ?? "";
const model = config.match(/^model = "([^"]+)"/m)?.[1] ?? "";
console.log("engine config:", { baseUrl, model });

// 1) codex 引擎版本
const vendorRoot = "node_modules/@openai/codex/vendor";
const entries = await fs.readdir(vendorRoot).catch(() => []);
let codexBin = "";
for (const dir of entries) {
  const candidate = path.join(vendorRoot, dir, "bin", "codex-x86_64-pc-windows-msvc.exe");
  try { await fs.access(candidate); codexBin = candidate; break; } catch {}
}
console.log("codex binary:", codexBin || "NOT FOUND");

// 2) 供应商连通性：直接 POST /responses（同引擎 wire_api=responses 的调用方式）
let apiKey = "";
try {
  const { stdin } = process;
  console.log("reading stored api key from key file if present...");
  const keyFile = path.join(codexHome, "harness-api-key.txt");
  apiKey = (await fs.readFile(keyFile, "utf8").catch(() => "")).trim();
} catch {}
if (!apiKey) console.log("no local key file; will test without auth header");

if (baseUrl) {
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, input: [{ role: "user", content: [{ type: "input_text", text: "Reply with exactly OK." }] }], stream: false, max_output_tokens: 16 }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    console.log(`provider probe: HTTP ${res.status} in ${Date.now() - started}ms`);
    console.log("body head:", text.slice(0, 300));
  } catch (error) {
    console.log(`provider probe FAILED after ${Date.now() - started}ms:`, error.message);
  }
}
