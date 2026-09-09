#!/usr/bin/env node
// Codex Harness 内置媒体插件命令行助手：
//   node harness-media.mjs image  "提示词"            → 生成图片，输出 JSON { path, url }（path=本地持久文件）
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
function readStdinText() { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } }

/** 从 data URL / 托管 URL / 响应字段推断图片扩展名（缺省 .png） */
function guessImageExt(url, item) {
  const fromMime = (mime) => {
    if (!mime) return "";
    if (/webp/i.test(mime)) return ".webp";
    if (/jpeg|jpg/i.test(mime)) return ".jpg";
    if (/gif/i.test(mime)) return ".gif";
    if (/png/i.test(mime)) return ".png";
    return "";
  };
  if (/^data:/i.test(url)) {
    const mime = url.slice(5, url.indexOf(",")).replace(/^image\//i, "");
    return fromMime(mime) || ".png";
  }
  const fromPath = (/^https?:\/\//i.test(url) ? new URL(url).pathname : url).match(/\.(webp|jpe?g|gif|png)$/i);
  if (fromPath) return "." + fromPath[1].toLowerCase().replace(/^jpeg$/, "jpg");
  return fromMime(item?.output_format ?? item?.background ?? "") || ".png";
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
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      let hint;
      try { hint = JSON.parse(detail)?.error?.message || ""; } catch { hint = detail.slice(0, 160); }
      throw new Error("生图失败 HTTP " + response.status + (hint ? "：" + hint : ""));
    }
    const data = await response.json();
    const item = data?.data?.[0] ?? {};
    const url = item.url || (item.b64_json ? "data:image/png;base64," + item.b64_json : "");
    if (typeof url !== "string" || !url.trim()) throw new Error("生图服务未返回图片地址或图片数据");
    // 持久化落地：网关返回的 http(s) 托管地址多为临时图床（实测隔夜 404，用户微信里图片变裂图）。
    // 下载存到 userData/images/（data URL 直接解码落盘），返回 path（本地持久文件，推荐引用）
    // + url（原始托管地址，可能很快失效）。落盘失败不影响返回原始 url。
    let savedPath = "";
    try {
      const ext = guessImageExt(url, item);
      const file = path.join(userData, "images", `codex-harness-${Date.now()}${ext}`);
      // 注意：这里 fs 是 node:fs（回调式 API），不传 callback 会同步抛 TypeError——用同步方法
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (/^data:/i.test(url)) {
        fs.writeFileSync(file, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
      } else if (/^https?:/i.test(url)) {
        const imgRes = await fetch(url, { signal: AbortSignal.timeout(120_000) });
        if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
        fs.writeFileSync(file, Buffer.from(await imgRes.arrayBuffer()));
      }
      if (fs.existsSync(file)) savedPath = file;
    } catch (error) { console.error(`[harness-media] 图片落盘失败（不影响返回，仍给原始 url）：${error?.message ?? error}`); }
    console.log(JSON.stringify(savedPath
      ? { path: savedPath, url, note: "path 是本地持久文件，引用图片请用它（view_image 可直接查看）；url 是生图网关的临时托管地址，可能很快失效，不要当永久链接发给用户" }
      : { url }));
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
    // 本地路径自动转 data URL：引擎消息里的图片是本地文件路径（不是 URL），模型照用法
    // 原样传过来会 400「invalid image」。路径存在就直接读文件转 base64，URL/dataURL 原样透传。
    let imageSource = target;
    if (!/^(https?:|data:)/i.test(target)) {
      const candidate = path.isAbsolute(target) ? target : path.resolve(target);
      if (!fs.existsSync(candidate)) {
        console.error(JSON.stringify({ error: "图片本地文件不存在：" + candidate }));
        process.exit(1);
      }
      const mime = /\.jpe?g$/i.test(candidate) ? "image/jpeg" : /\.gif$/i.test(candidate) ? "image/gif" : /\.webp$/i.test(candidate) ? "image/webp" : "image/png";
      imageSource = `data:${mime};base64,` + fs.readFileSync(candidate).toString("base64");
    }
    const base = conf.baseUrl.trim().replace(/\/$/, "");
    const endpoint = /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
    const content = [
      { type: "text", text: prompt || "请详细描述这张图片的内容，包括画面主体、场景、文字、布局等，用中文回答。" },
      { type: "image_url", image_url: { url: imageSource } },
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
