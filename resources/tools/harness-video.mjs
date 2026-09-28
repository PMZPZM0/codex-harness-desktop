#!/usr/bin/env node
// Codex Harness 视频生成命令行助手（09-28）：
//   node harness-video.mjs providers
//       → JSON：8 家厂商 + configured（是否已配凭证）
//   node harness-video.mjs all --provider kling --prompt "..." [--image 首帧.png] [--workspace dir] [--name out.mp4] [--duration 5] [--model x]
//       → 一条龙：提交 → 轮询（5s 间隔 / 上限 10 分钟）→ 下载落盘 → JSON { path, bytes, jobId }
//   分步：submit（→{jobId}）/ poll --provider x --job-id y（→{status,url?}）/ download --url u --workspace w
// 配置读 userData/video-providers.json（与「设置 → 插件 → 视频生成接口」同一份）。
// userData 解析与主进程 data-dir.ts 同口径：CODEX_HARNESS_USER_DATA env → data-dir.json 指路牌 → 默认 APPDATA。
// 设计动机同 harness-media.mjs：dynamicTools 只在 thread/start 注入（老会话没有），命令行助手
// 让所有会话（新/老）都能真实调用；厂商适配**复用 src/lib/video-providers.mjs 同一份代码**，
// 不在 CLI 里重复实现 8 家协议（重复实现必然漂移）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // ESM 无 __dirname

const userData = (() => {
  const envDir = process.env.CODEX_HARNESS_USER_DATA;
  if (envDir) return envDir;
  const fallback = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Codex Harness Desktop");
  try {
    const boot = JSON.parse(fs.readFileSync(path.join(fallback, "data-dir.json"), "utf8"));
    // 与主进程同款合法性：绝对路径、不能是盘根
    if (boot?.dir && path.isAbsolute(boot.dir) && path.parse(boot.dir).root !== boot.dir) return boot.dir;
  } catch { /* 无指路牌 ⇒ 默认目录 */ }
  return fallback;
})();
const configPath = path.join(userData, "video-providers.json");
function loadConfig() { try { return JSON.parse(fs.readFileSync(configPath, "utf8")); } catch { return {}; } }

function fail(message) { console.log(JSON.stringify({ error: message })); process.exit(1); }

function parseOptions(rest) {
  const o = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) { const v = rest[i + 1]; o[a.slice(2)] = !v || v.startsWith("--") ? true : rest[++i]; }
    else o.prompt = (o.prompt ? o.prompt + " " : "") + a;
  }
  return o;
}

/** 本地文件 → base64；http(s) URL 原样透传（与主进程 resolveImage 同口径） */
function resolveImage(image) {
  if (!image) return undefined;
  if (/^https?:\/\//i.test(image)) return image;
  return fs.readFileSync(path.resolve(String(image))).toString("base64");
}

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 10 * 60_000;

(async () => {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const opts = parseOptions(argv.slice(1));

  // 适配层定位：本目录（打包后 extraResources 的 tools/ 副本）→ 开发仓 src/lib
  const adapterFile = [
    path.join(__dirname, "video-providers.mjs"),
    path.join(__dirname, "..", "..", "src", "lib", "video-providers.mjs"),
  ].find((c) => fs.existsSync(c));
  if (!adapterFile) fail("找不到厂商适配层 video-providers.mjs（安装包应含 tools/video-providers.mjs 副本）");
  const adapter = await import(pathToFileURL(adapterFile).href);
  const { VIDEO_PROVIDERS } = adapter;
  const config = loadConfig();
  const hasCredentials = (id) => {
    const p = VIDEO_PROVIDERS.find((x) => x.id === id);
    return !!p && !!config[id] && p.fields.every((f) => String(config[id][f] ?? "").trim());
  };

  if (cmd === "providers") {
    console.log(JSON.stringify(VIDEO_PROVIDERS.map((p) => ({
      id: p.id, name: p.name, region: p.region, modes: p.modes, imageInput: p.imageInput,
      defaultModel: p.defaultModel, baseUrl: p.baseUrl, configured: hasCredentials(p.id),
    })), null, 2));
    return;
  }

  const providerId = String(opts.provider ?? "");
  const provider = VIDEO_PROVIDERS.find((p) => p.id === providerId);
  if (!provider) fail(`未知厂商：${providerId}（先跑 providers 子命令列出全部）`);
  if (!hasCredentials(providerId)) fail(`厂商「${provider.name}」未配置凭证 —— 在 设置 → 插件 → 视频生成接口 里填写`);

  const applyCfg = { ...(config[providerId] ?? {}) };
  const image = await resolveImage(opts.image);
  const input = { mode: opts.mode === "i2v" ? "i2v" : "t2v", prompt: String(opts.prompt ?? ""), image, model: opts.model, duration: opts.duration ? Number(opts.duration) : undefined };
  // 与主进程 videoAssertImageOk 同口径的前置拒绝（url-only 厂商吃本地字节必被远端拒）
  if (input.mode === "i2v" && image && provider.imageInput === "url" && !/^https?:\/\//i.test(image)) {
    fail(`${provider.name} 只接受公网图片 URL —— 本地首帧请改用可灵 / 智谱 / MiniMax / Runway / Veo`);
  }

  const downloadTo = (url) => {
    const workspace = path.resolve(String(opts.workspace || process.cwd()));
    const dir = path.join(workspace, ".drama-canvas", "assets", "video");
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, String(opts.name || `video-${Date.now()}.mp4`).replace(/[\\/:*?"<>|]/g, "_").slice(0, 80));
    return fetch(url).then(async (resp) => {
      if (!resp.ok) fail(`下载失败 HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(dest, buf);
      return { path: dest, bytes: buf.length };
    });
  };

  if (cmd === "submit") {
    const req = adapter.videoApplyBaseUrl(adapter.videoBuildSubmit(providerId, applyCfg, input, Date.now()), providerId, applyCfg);
    const json = await (await fetch(req.url, req)).json().catch(() => ({}));
    console.log(JSON.stringify({ provider: providerId, jobId: adapter.videoParseSubmit(providerId, json) }));
    return;
  }
  if (cmd === "poll") {
    const req = adapter.videoApplyBaseUrl(adapter.videoBuildPoll(providerId, applyCfg, String(opts["job-id"] ?? ""), Date.now()), providerId, applyCfg);
    const pj = await (await fetch(req.url, req)).json().catch(() => ({}));
    console.log(JSON.stringify(adapter.videoParsePoll(providerId, pj)));
    return;
  }
  if (cmd === "download") {
    console.log(JSON.stringify(await downloadTo(String(opts.url ?? ""))));
    return;
  }
  if (cmd === "all") {
    const req = adapter.videoApplyBaseUrl(adapter.videoBuildSubmit(providerId, applyCfg, input, Date.now()), providerId, applyCfg);
    const json = await (await fetch(req.url, req)).json().catch(() => ({}));
    const jobId = adapter.videoParseSubmit(providerId, json);
    process.stderr.write(`submitted: ${providerId} ${jobId}\n`);
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let result = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const preq = adapter.videoApplyBaseUrl(adapter.videoBuildPoll(providerId, applyCfg, jobId, Date.now()), providerId, applyCfg);
      const pj = await (await fetch(preq.url, preq)).json().catch(() => ({}));
      result = adapter.videoParsePoll(providerId, pj);
      if (result.status === "succeeded" || result.status === "failed") break;
      process.stderr.write(`poll: ${result.status}\n`);
    }
    if (!result || result.status !== "succeeded") fail(`视频任务未成功：${JSON.stringify(result ?? {})}`);
    let url = result.url;
    if (!url && result.fileId) {
      // MiniMax 两段式：file_id → 下载地址
      const retrieve = adapter.videoApplyBaseUrl(adapter.videoBuildFileRetrieve(applyCfg, result.fileId), providerId, applyCfg);
      url = adapter.videoParseFileRetrieve(await (await fetch(retrieve.url, retrieve)).json().catch(() => ({})));
    }
    if (!url) fail("任务成功但没有产物地址");
    console.log(JSON.stringify({ provider: providerId, jobId, ...(await downloadTo(url)) }));
    return;
  }
  fail(`未知子命令：${cmd}（可用：providers / submit / poll / download / all）`);
})().catch((e) => fail(e?.message ?? String(e)));
