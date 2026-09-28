/**
 * video-gen：内置视频生成接口（09-27）。IPC 前缀 `video:` 共 6 通道。
 *
 * 职责只有「通道」：厂商适配全部在 src/lib/video-providers.mjs（纯函数，守卫真跑）。
 *  - video:providers   厂商清单 + 各家是否已配凭证
 *  - video:config-read / video:config-save   凭证存 userData/video-providers.json
 *  - video:submit      提交异步任务 → jobId（⛔ 首帧文件在主进程读成 base64 再进适配层）
 *  - video:poll        查询任务（MiniMax 成功后还要拿 file_id 换下载地址，两层都在这处理）
 *  - video:download    把产物 URL 拉回本地落到工作区（复用 drama-canvas 的可信根校验）
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { app, ipcMain } from "electron";
import { isInsideTrustedRoots } from "../runtime-refs";
import {
  videoAssertImageOk,
  videoBuildFileRetrieve,
  VIDEO_OPTIONAL_FIELDS,
  videoApplyBaseUrl,
  videoBuildPoll,
  videoBuildSubmit,
  videoParseFileRetrieve,
  videoParsePoll,
  videoParseSubmit,
  VIDEO_PROVIDERS,
} from "../../src/lib/video-providers.mjs";

function configPath(): string {
  // ⛔ 惰性求值：app.getPath 在 ready 前后返回值不同（app.setPath userData 改写过），
  //    不能在模块顶层求值（【91】），调用时才取。
  return path.join(app.getPath("userData"), "video-providers.json");
}

type ProviderConfig = Record<string, string>;
type ConfigFile = Record<string, ProviderConfig>;

function readConfig(): ConfigFile {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8")) as ConfigFile;
  } catch {
    return {};
  }
}

async function writeConfig(config: ConfigFile): Promise<void> {
  await fsp.mkdir(path.dirname(configPath()), { recursive: true });
  await fsp.writeFile(configPath(), JSON.stringify(config, null, 2) + "\n", "utf8");
}

const hasCredentials = (providerId: string, cfg: ProviderConfig | undefined) =>
  !!cfg && VIDEO_PROVIDERS.find((p) => p.id === providerId)?.fields.every((f) => String(cfg[f] ?? "").trim());

async function fetchJson(url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown }): Promise<any> {
  const response = await fetch(url, {
    method: init.method ?? (init.body != null ? "POST" : "GET"),
    headers: init.headers,
    body: init.body != null ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`响应不是 JSON（HTTP ${response.status}）：${text.slice(0, 160)}`);
  }
}

/** 本地首帧 → base64（veo/runway 等要字节；http(s) URL 原样透传给支持 url 的厂商）。 */
async function resolveImage(image?: string): Promise<string | undefined> {
  if (!image) return undefined;
  if (/^https?:\/\//i.test(image)) return image;
  const clean = image.replace(/^file:\/\//, "");
  const buffer = await fsp.readFile(clean);
  return buffer.toString("base64");
}

export function registerVideoGen(): void {
  ipcMain.handle("video:providers", async () => {
    const config = readConfig();
    return VIDEO_PROVIDERS.map((provider) => ({ ...provider, configured: hasCredentials(provider.id, config[provider.id]) }));
  });

  ipcMain.handle("video:config-read", async () => readConfig());

  ipcMain.handle("video:config-save", async (_event, input: { providerId: string; values: ProviderConfig }) => {
    const provider = VIDEO_PROVIDERS.find((p) => p.id === String(input?.providerId ?? ""));
    if (!provider) throw new Error(`未知厂商：${input?.providerId}`);
    const config = readConfig();
    const values: ProviderConfig = {};
    // ⛔ 09-28：凭证之外还允许用户覆盖「API 地址 / 模型」（中转站、代理、自部署网关）。
    //    VIDEO_OPTIONAL_FIELDS 是这两项的唯一定义处 —— 白名单必须收它，否则用户填了保存不住。
    for (const field of [...provider.fields, ...VIDEO_OPTIONAL_FIELDS]) values[field] = String(input?.values?.[field] ?? "").trim();
    config[provider.id] = values;
    await writeConfig(config);
    return { ok: true, configured: hasCredentials(provider.id, values) };
  });

  ipcMain.handle("video:submit", async (_event, input: { providerId: string; mode: "t2v" | "i2v"; prompt: string; image?: string; model?: string; duration?: number }) => {
    const config = readConfig();
    const provider = videoAssertImageOk(String(input?.providerId ?? ""), input?.mode === "i2v" ? "i2v" : "t2v", input?.image);
    const cfg = config[provider.id];
    if (!hasCredentials(provider.id, cfg)) throw new Error(`${provider.name} 还没配置凭证（设置 → 插件 → 视频生成接口）`);
    const image = input.mode === "i2v" ? await resolveImage(input.image) : undefined;
    // 自定义 API 地址在本层统一应用（submit / poll / retrieve 都经这里，适配层保持纯函数）
    const request = videoApplyBaseUrl(videoBuildSubmit(provider.id, cfg ?? {}, { ...input, image }, Date.now()), provider.id, cfg);
    const response = await fetchJson(request.url, request);
    return { jobId: videoParseSubmit(provider.id, response) };
  });

  ipcMain.handle("video:poll", async (_event, input: { providerId: string; jobId: string }) => {
    const config = readConfig();
    const providerId = String(input?.providerId ?? "");
    const provider = VIDEO_PROVIDERS.find((p) => p.id === providerId);
    if (!provider) throw new Error(`未知厂商：${providerId}`);
    const cfg = config[providerId] ?? {};
    const request = videoApplyBaseUrl(videoBuildPoll(providerId, cfg, String(input?.jobId ?? ""), Date.now()), providerId, cfg);
    const response = await fetchJson(request.url, request);
    const result = videoParsePoll(providerId, response);
    if (result.status === "succeeded" && !result.url && result.fileId) {
      // MiniMax 两段式：file_id → 下载地址
      const retrieve = videoApplyBaseUrl(videoBuildFileRetrieve(cfg, result.fileId), providerId, cfg);
      result.url = videoParseFileRetrieve(await fetchJson(retrieve.url, retrieve));
    }
    return result;
  });

  ipcMain.handle("video:download", async (_event, input: { url: string; workspace: string; name: string; subdir?: string }) => {
    const url = String(input?.url ?? "");
    if (!/^https?:\/\//i.test(url)) throw new Error(`产物地址不是 http(s)：${url.slice(0, 80)}`);
    if (!input?.workspace || !isInsideTrustedRoots(String(input.workspace))) throw new Error("工作目录不在可信根内，拒绝写盘");
    const safeName = String(input.name || "video.mp4").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
    const dir = path.join(String(input.workspace), ".drama-canvas", "assets", String(input.subdir || "video"));
    await fsp.mkdir(dir, { recursive: true });
    const dest = path.join(dir, safeName);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fsp.writeFile(dest, buffer);
    return { path: dest, bytes: buffer.length };
  });
}
