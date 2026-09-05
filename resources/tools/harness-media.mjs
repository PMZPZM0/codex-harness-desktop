#!/usr/bin/env node
// Codex Harness 内置媒体插件命令行助手：
//   node harness-media.mjs image  "提示词"            → 生成图片，输出 JSON { url }
//   node harness-media.mjs vision "图片URL或dataURL" ["关注点"] → 视觉描述，输出 JSON { text }
// 配置读 userData/builtin-plugins.json（与「插件 → 内置插件」页同一份）。
// 未配置对应插件时输出错误 JSON 并以非零码退出，引擎据此向用户说明。
// 设计动机：dynamicTools 只在 thread/start 时注入（老会话没有），命令行助手
// 让所有会话（新/老）都能真实调用，developer_instructions 负责告知用法。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const userData = process.env.CODEX_HARNESS_USERDATA
  || path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Codex Harness Desktop");
const configPath = path.join(userData, "builtin-plugins.json");

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, "utf8")); } catch { return {}; }
}

// Electron safeStorage 加密的密钥以 base64 存在配置里（encryptedKey 字段可选）；
// 明文 apiKey 优先。这里不解密（CLI 拿不到 Electron safeStorage key），
// 因此主进程在保存配置时同时写一份「引擎可读」的明文密钥到 builtin-plugins.json。
function readStdinText() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

async function main() {
  const [kind, ...rest] = process.argv.slice(2);
  const cfg = loadConfig();
  if (kind === "image") {
    const prompt = rest.join(" ").trim() || readStdinText().trim();
    const conf = cfg.image;
    if (!conf || conf.enabled === false || !conf.baseUrl || !conf.apiKey || !conf.model) {
      console.error(JSON.stringify({ error: "生图插件未配置：请到 设置 → 插件 → 内置插件 完成「生图插件」配置" }));
      process.exit(2);
    }
    if (!prompt) { console.error(JSON.stringify({ error: "缺少图片描述（prompt）" })); process.exit(2); }
    const base = conf.baseUrl.trim().replace(/\/$/, "");
    const endpoint = /\/images\/generations$/.test(base) ? base : base + "/images/generations";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + conf.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model: conf.model, prompt, n: 1 }),
    });
    if (!response.ok) { console.error(JSON.stringify({ error: "生图失败 HTTP " + response.status })); process.exit(1); }
    const data = await response.json();
    const item = data?.data?.[0] ?? {};
    const url = item.url || (item.b64_json ? "data:image/png;base64," + item.b64_json : "");
    if (!url) { console.error(JSON.stringify({ error: "生图服务未返回图片地址" })); process.exit(1); }
    console.log(JSON.stringify({ url }));
    return;
  }
  if (kind === "vision") {
    const [imageUrl, ...promptParts] = rest;
    const prompt = promptParts.join(" ").trim() || readStdinText().trim() || "";
    const conf = cfg.vision;
    if (!conf || conf.enabled === false || !conf.baseUrl || !conf.apiKey || !conf.model) {
      console.error(JSON.stringify({ error: "视觉辅助插件未配置：请到 设置 → 插件 → 内置插件 完成「视觉辅助插件」配置" }));
      process.exit(2);
    }
    const target = (imageUrl ?? "").trim() || readStdinText().trim();
    if (!target) { console.error(JSON.stringify({ error: "缺少图片地址或 data URL" })); process.exit(2); }
    const base = conf.baseUrl.trim().replace(/\/$/, "");
    const endpoint = /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
    const content = [
      { type: "text", text: prompt || "请详细描述这张图片的内容，包括画面主体、场景、文字、布局等，用中文回答。" },
      { type: "image_url", image_url: { url: target } },
    ];
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + conf.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model: conf.model, messages: [{ role: "user", content }] }),
    });
    if (!response.ok) { console.error(JSON.stringify({ error: "识图失败 HTTP " + response.status })); process.exit(1); }
    const data = await response.json();
    console.log(JSON.stringify({ text: data?.choices?.[0]?.message?.content ?? "" }));
    return;
  }
  console.error(JSON.stringify({ error: "用法: harness-media.mjs image|vision <参数>（详情见 developer_instructions）" }));
  process.exit(2);
}

main().catch((error) => { console.error(JSON.stringify({ error: String(error?.message ?? error) })); process.exit(1); });
