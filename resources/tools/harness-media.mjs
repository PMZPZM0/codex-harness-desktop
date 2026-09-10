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

// 生图可选参数（内置示例）：
//   --size 2160x2880 | --preset 34-2k | --quality high | --model gpt-image-2-4k
//   --ref 参考图.png（可多个，自动改走 images/edits 改图）| --n 1 | --out 输出路径
// 模型默认取插件配置（设置 → 插件 → 内置插件的「模型」项），--model 只在临时换档位时用，不要拿它当默认。
// 部分 SKU 会静默忽略 size（如 sunburst 固定约 1086x1448），此时输出会带 warning 字段。
const PRESETS = {
  "11-1k": "1024x1024", "11-2k": "2048x2048",
  "34-1k": "1152x1536", "34-2k": "2160x2880", "34-max": "2448x3264",
  "43-2k": "2880x2160", "169-2k": "2560x1440", "169-4k": "3840x2160",
};
function parseOptions(args) {
  const o = { ref: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--ref") { while (args[i + 1] && !args[i + 1].startsWith("--")) o.ref.push(args[++i]); }
    else if (a.startsWith("--")) { const v = args[i + 1]; o[a.slice(2)] = !v || v.startsWith("--") ? true : args[++i]; }
    else o.prompt = (o.prompt ? o.prompt + " " : "") + a;
  }
  if (o.preset) o.size = o.size || PRESETS[o.preset];
  return o;
}
function checkSize(size) {
  const [w, h] = String(size).split("x").map(Number);
  if (!w || !h || w % 16 || h % 16) throw new Error(`size 宽高必须是 16 的倍数: ${size}`);
  if (Math.max(w, h) / Math.min(w, h) > 3) throw new Error(`size 比例不能超过 3:1: ${size}`);
  if (w * h < 655360 || w * h > 8294400) throw new Error(`size 像素需在 655360-8294400 之间: ${size}`);
  return `${w}x${h}`;
}

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
    const opt = parseOptions(rest);
    if (opt.help) { console.log(JSON.stringify({ 用法: 'harness-media.mjs image "提示词" [选项]', 选项: ["--size 2160x2880", "--preset 34-2k", "--quality high", "--model gpt-image-2-4k", "--ref 参考图.png", "--n 1", "--out 输出路径"], 预设: PRESETS, 提示: "模型默认跟随插件配置（下拉框值），--model 仅临时覆盖；输出若带 warning 说明该 SKU 不支持所请求的尺寸" }, null, 1)); return; }
    const prompt = (opt.prompt || "").trim() || readStdinText().trim();
    const conf = cfg.image;
    if (!conf || conf.enabled === false || !conf.baseUrl || !conf.apiKey || !conf.model) {
      console.error(JSON.stringify({ error: "生图插件未配置：请到 设置 → 插件 → 内置插件 完成「生图插件」配置" }));
      process.exit(2);
    }
    if (!prompt) { console.error(JSON.stringify({ error: "缺少图片描述（prompt）" })); process.exit(2); }
    const base = conf.baseUrl.trim().replace(/\/$/, "");
    const root = base.replace(/\/images\/(generations|edits)$/, "");
    const endpoint = root + (opt.ref.length ? "/images/edits" : "/images/generations");
    const fields = { model: opt.model || conf.model, prompt, n: String(opt.n || 1) };
    if (opt.size) fields.size = checkSize(opt.size);
    if (opt.quality) fields.quality = opt.quality;
    let response;
    if (opt.ref.length) {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      for (const [i, p] of opt.ref.entries()) form.append("image", new Blob([fs.readFileSync(p)], { type: /\.jpe?g$/i.test(p) ? "image/jpeg" : "image/png" }), "ref" + i + ".png");
      response = await fetch(endpoint, { method: "POST", headers: { Authorization: "Bearer " + conf.apiKey }, body: form, signal: AbortSignal.timeout(600_000) });
    } else {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer " + conf.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({}, fields, { n: Number(fields.n) })),
        signal: AbortSignal.timeout(300_000),
      });
    }
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
    let actualPx = "";
    try {
      const ext = guessImageExt(url, item);
      const file = opt.out ? path.resolve(opt.out) : path.join(userData, "images", `codex-harness-${Date.now()}${ext}`);
      // 注意：这里 fs 是 node:fs（回调式 API），不传 callback 会同步抛 TypeError——用同步方法
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (/^data:/i.test(url)) {
        fs.writeFileSync(file, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
      } else if (/^https?:/i.test(url)) {
        const imgRes = await fetch(url, { signal: AbortSignal.timeout(120_000) });
        if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
        fs.writeFileSync(file, Buffer.from(await imgRes.arrayBuffer()));
      }
      if (opt.size) {
        // 网关可能虚报 size，用 PNG 头里的真实宽高做校验
        const fd = fs.openSync(file, "r"); const head = Buffer.alloc(33);
        fs.readSync(fd, head, 0, 33, 0); fs.closeSync(fd);
        if (head.subarray(1, 4).toString() === "PNG") actualPx = head.readUInt32BE(16) + "x" + head.readUInt32BE(20);
      }
      if (fs.existsSync(file)) savedPath = file;
    } catch (error) { console.error(`[harness-media] 图片落盘失败（不影响返回，仍给原始 url）：${error?.message ?? error}`); }
    const actualSize = actualPx || data?.size || "";
    const warning = opt.size && actualSize && actualSize !== fields.size
      ? `模型 ${fields.model} 实际输出 ${actualSize}，与请求的 ${fields.size} 不符：该档位不支持此尺寸（网关会虚报 size），请在插件设置的「模型」项改用支持该尺寸的档位`
      : "";
    console.log(JSON.stringify(savedPath
      ? { path: savedPath, ...(/^https?:/i.test(url) ? { url } : {}), note: "path 是本地持久文件，引用图片请用它（view_image 可直接查看）；url 是生图网关的临时托管地址，可能很快失效，不要当永久链接发给用户", ...(warning ? { warning } : {}) }
      : { url: /^https?:/i.test(url) ? url : "(内联 data URL，已落盘见 path)", ...(warning ? { warning } : {}) }));
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
