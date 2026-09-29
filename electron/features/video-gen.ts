/**
 * video-gen：内置视频生成接口（09-27）。IPC 前缀 `video:` 共 6 通道。
 *
 * 职责只有「通道」：厂商适配全部在 src/lib/video-providers.mjs（纯函数，守卫真跑）。
 *  - video:providers   厂商清单 + 各家是否已配凭证
 *  - video:config-read / video:config-save   凭证存 userData/video-providers.json
 *  - video:submit      提交异步任务 → jobId（⛔ 首帧文件在主进程读成 base64 再进适配层）
 *  - video:poll        查询任务（MiniMax 成功后还要拿 file_id 换下载地址，两层都在这处理）
 *  - video:download    把产物 URL 拉回本地落到工作区（复用 drama-canvas 的可信根校验）
 *  - video:concat      按给定顺序合并多个片段成一条成片（09-29 整片导出；ffmpeg，copy 优先）
 *
 * ⛔⛔ 09-29 抽 core：提交 / 查询 / 下载三段的**逻辑**抽成导出函数（handler 只是薄壳），
 *   好让会话里的 MCP 工具（image_generate / video_generate / video_status）直接复用同一实现 ——
 *   同一动作两套实现是本仓反复踩过的坑（文案漂移、行为不一致）。
 * ⛔ 09-29 加**任务持久化**（userData/video-jobs.json）：此前 jobId 只活在渲染层内存里，
 *   关掉画布或重启应用 = 任务丢失、产物白跑；现在提交即落盘，随时可续查（模型也能查）。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { app, ipcMain } from "electron";
import { isInsideTrustedRoots } from "../runtime-refs";
import { bundledFfprobe, ffmpegMissingMessage, resolveFfmpegPath } from "../toolchain";
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

/* ────────────────────────────── 任务持久化（09-29）────────────────────────────── */

export type VideoJob = {
  jobId: string;
  providerId: string;
  prompt: string;
  mode: "t2v" | "i2v";
  image?: string;
  /** 期望的落盘位置（查询成功时若给了 workspace 就自动下载） */
  workspace?: string;
  name?: string;
  submittedAt: number;
  updatedAt: number;
  status: "pending" | "succeeded" | "failed";
  url?: string;
  path?: string;
  error?: string;
};

function jobsPath(): string {
  return path.join(app.getPath("userData"), "video-jobs.json");
}

/** 读全部任务记录（按提交时间倒序；顺带裁掉 30 天前的旧记录，防文件无限增长） */
export function listVideoJobs(): VideoJob[] {
  let list: VideoJob[] = [];
  try {
    const raw = JSON.parse(fs.readFileSync(jobsPath(), "utf8"));
    list = Array.isArray(raw) ? raw.filter((j) => j && j.jobId) : [];
  } catch { list = []; }
  const cutoff = Date.now() - 30 * 86_400_000;
  const kept = list.filter((j) => (j.submittedAt || 0) >= cutoff);
  if (kept.length !== list.length) writeVideoJobs(kept);
  return kept.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
}

/** ⛔ 同步写（09-29 离线验证抓到竞态）：原来 `void fs.writeFile(...)` 异步落盘且不等待 ——
 *  「提交后立刻查询」会读到还没写完的旧文件，任务看起来"没记录"。文件很小、调用低频，
 *  同步写换来确定性（宁可阻塞 1ms，也不要"查不到刚提交的任务"）。 */
function writeVideoJobs(list: VideoJob[]): void {
  try {
    fs.mkdirSync(path.dirname(jobsPath()), { recursive: true });
    fs.writeFileSync(jobsPath(), JSON.stringify(list, null, 2) + "\n", "utf8");
  } catch { /* 落盘失败不影响生成本身 */ }
}

/** 记一条任务（提交成功即调用） */
export function rememberVideoJob(record: Omit<VideoJob, "updatedAt" | "status"> & { status?: VideoJob["status"] }): VideoJob {
  const full: VideoJob = { ...record, status: record.status ?? "pending", updatedAt: Date.now() };
  const list = listVideoJobs().filter((j) => j.jobId !== full.jobId);
  list.unshift(full);
  writeVideoJobs(list.slice(0, 200));
  return full;
}

/** 更新一条任务（查询后回写状态/产物路径） */
export function updateVideoJob(jobId: string, patch: Partial<VideoJob>): VideoJob | null {
  const list = listVideoJobs();
  const hit = list.find((j) => j.jobId === jobId);
  if (!hit) return null;
  Object.assign(hit, patch, { updatedAt: Date.now() });
  writeVideoJobs(list);
  return hit;
}

export function findVideoJob(jobId: string): VideoJob | null {
  return listVideoJobs().find((j) => j.jobId === jobId) ?? null;
}

/* ────────────────────────────── core（IPC 与 MCP 共用）────────────────────────────── */

export type VideoProviderView = { id: string; name: string; configured: boolean; imageInput?: string; defaultModel?: string; note?: string };

export function videoProviderViews(): VideoProviderView[] {
  const config = readConfig();
  return VIDEO_PROVIDERS.map((p) => ({
    id: p.id, name: p.name, configured: Boolean(hasCredentials(p.id, config[p.id])),
    imageInput: (p as any).imageInput, defaultModel: (p as any).defaultModel, note: (p as any).note,
  }));
}

/** 提交任务（含 i2v 首帧解析、自定义 baseUrl 应用） */
export async function submitVideoCore(input: { providerId: string; mode: "t2v" | "i2v"; prompt: string; image?: string; model?: string; duration?: number }): Promise<{ jobId: string }> {
  const config = readConfig();
  const provider = videoAssertImageOk(String(input?.providerId ?? ""), input?.mode === "i2v" ? "i2v" : "t2v", input?.image);
  const cfg = config[provider.id];
  if (!hasCredentials(provider.id, cfg)) throw new Error(`${provider.name} 还没配置凭证（设置 → 插件 → 视频生成接口）`);
  const image = input.mode === "i2v" ? await resolveImage(input.image) : undefined;
  // 自定义 API 地址在本层统一应用（submit / poll / retrieve 都经这里，适配层保持纯函数）
  const request = videoApplyBaseUrl(videoBuildSubmit(provider.id, cfg ?? {}, { ...input, image }, Date.now()), provider.id, cfg);
  const response = await fetchJson(request.url, request);
  return { jobId: videoParseSubmit(provider.id, response) };
}

/** 查询任务状态（succeeded 时带 url；MiniMax 两段式在内部完成二次取址） */
export async function pollVideoCore(input: { providerId: string; jobId: string }): Promise<{ status: "queued" | "running" | "pending" | "succeeded" | "failed"; url?: string; error?: string; fileId?: string }> {
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
}

/** 产物 URL → 工作区 .drama-canvas/assets/<subdir>（09-29：加 1 次自动重试，网络抖动不再白跑） */
export async function downloadVideoCore(input: { url: string; workspace: string; name: string; subdir?: string }): Promise<{ path: string; bytes: number }> {
  const url = String(input?.url ?? "");
  if (!/^https?:\/\//i.test(url)) throw new Error(`产物地址不是 http(s)：${url.slice(0, 80)}`);
  if (!input?.workspace || !isInsideTrustedRoots(String(input.workspace))) throw new Error("工作目录不在可信根内，拒绝写盘");
  const safeName = String(input.name || "video.mp4").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
  const dir = path.join(String(input.workspace), ".drama-canvas", "assets", String(input.subdir || "video"));
  await fsp.mkdir(dir, { recursive: true });
  const dest = path.join(dir, safeName);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) throw new Error("下载到 0 字节");
      await fsp.writeFile(dest, buffer);
      return { path: dest, bytes: buffer.length };
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/* ────────────────────────────── 整片合并（09-29）────────────────────────────── */

/** 跑一条 ffmpeg 命令，收集 stderr（ffmpeg 把诊断都写 stderr）。退出码非 0 抛错并附尾部日志。 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-4000); });
    child.on("error", (error) => reject(new Error(ffmpegMissingMessage() + `（${error.message}）`)));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 退出码 ${code}：${stderr.split("\n").filter(Boolean).slice(-3).join(" / ").slice(0, 400)}`));
    });
  });
}

/** ffmpeg 是否真的可用（PATH 回落的裸名要先探一次 —— 直接 spawn 失败会以中文报错遮住真实原因）。 */
async function ffmpegUsable(): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(resolveFfmpegPath(), ["-version"], { windowsHide: true, stdio: "ignore" });
      child.on("error", reject);
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(String(code)))));
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 片段的「拼接兼容签名」：视频编码 / 分辨率 / 帧率 / 像素格式 / 音频编码。
 *
 * ⛔⛔ 为什么必须**先比签名**，而不是「copy 失败再回退重编码」—— 09-29 实测抓到的真缺陷：
 *   把 320x240@10 和 640x480@25 两段用 `-f concat -c copy` 拼接，ffmpeg **退出码 0、不报错**，
 *   产物却是花屏 + 时基错乱的坏片。静默产出坏片比直接报错更糟（用户拿着成片才知道坏了）。
 *   所以：签名全一致才敢 copy，否则直接走重编码。
 * 探测不了（没有 ffprobe / 文件异常）时返回空串，调用方按「不兼容」处理 —— 重编码是安全路径。
 */
async function probeSignature(file: string): Promise<string> {
  const ffprobe = bundledFfprobe();
  if (!ffprobe) return "";
  const json = await new Promise<string>((resolve) => {
    const child = spawn(
      ffprobe,
      ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt", "-of", "json", file],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    child.stdout?.on("data", (chunk) => { out += String(chunk); });
    child.on("error", () => resolve(""));
    child.on("exit", (code) => resolve(code === 0 ? out : ""));
  });
  try {
    const streams = ((JSON.parse(json).streams || []) as Array<Record<string, any>>);
    const video = streams.find((s) => s.codec_type === "video") || {};
    const audio = streams.find((s) => s.codec_type === "audio") || {};
    return [video.codec_name, video.width, video.height, video.r_frame_rate, video.pix_fmt, audio.codec_name || "none"].join("|");
  } catch {
    return "";
  }
}

/**
 * 把多个视频片段按给定顺序合并成一条成片（分镜「整片导出」用）。
 *
 * 两段式（**copy 优先、失败重编码**）：
 *   ① `-c copy`：无重编码，秒级完成、零画质损失 —— 所有片段编码参数一致时才成立；
 *   ② 回落统一重编码：片段来自不同厂商（各家分辨率 / 帧率 / 像素格式都不同），
 *      copy 会花屏或直接报错 ⇒ 统一 scale+pad 到同一画布 + 统一帧率，H.264/AAC 输出。
 *
 * ⛔ 用 concat demuxer（`-f concat -i list.txt`）而不是 filter_complex：几十个片段时
 *    filter 图会让命令行长度爆炸且难排查。
 * ⛔ 片段路径写进工作区内的临时清单文件；Windows 路径在清单里必须转正斜杠（ffmpeg 的
 *    concat 解析对反斜杠敏感），单引号也要转义（清单语法用单引号包裹路径）。
 * ⛔ 输出落 `<工作区>/.drama-canvas/export/`（与素材同根，随会话走）。
 */
export async function concatVideosCore(input: {
  workspace: string;
  name: string;
  files: string[];
  width?: number;
  height?: number;
  fps?: number;
}): Promise<{ path: string; bytes: number; mode: "copy" | "reencode"; parts: number }> {
  const workspace = String(input?.workspace ?? "");
  if (!workspace) throw new Error("请先为会话选择工作文件夹，再导出成片");
  if (!isInsideTrustedRoots(workspace)) throw new Error("只允许把成片写进会话工作区或应用数据目录");

  // ① 片段校验：全部存在且是**文件**（目录混进来会让 ffmpeg 报奇怪的错）
  const files: string[] = [];
  for (const raw of input?.files || []) {
    const file = path.resolve(String(raw));
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat) throw new Error(`片段不存在：${file}`);
    if (!stat.isFile()) throw new Error(`片段不是文件，拒绝合并：${file}`);
    if (stat.size === 0) throw new Error(`片段是空文件：${file}`);
    files.push(file);
  }
  if (!files.length) throw new Error("没有可合并的视频片段 —— 先给镜头生成视频");
  if (files.length === 1) {
    // 单片不必进 ffmpeg（copy 一遍没意义），但仍要走落盘路径，保证「导出成片」永远有产物
    const dir = path.join(workspace, ".drama-canvas", "export");
    await fsp.mkdir(dir, { recursive: true });
    const dest = path.join(dir, safeVideoName(input?.name));
    await fsp.copyFile(files[0], dest);
    const stat = await fsp.stat(dest);
    return { path: dest, bytes: stat.size, mode: "copy", parts: 1 };
  }

  if (!(await ffmpegUsable())) throw new Error(ffmpegMissingMessage());

  const dir = path.join(workspace, ".drama-canvas", "export");
  await fsp.mkdir(dir, { recursive: true });
  const dest = path.join(dir, safeVideoName(input?.name));
  const listFile = path.join(dir, `.concat-${Date.now()}.txt`);
  const list = files.map((file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n") + "\n";
  await fsp.writeFile(listFile, list, "utf8");

  try {
    const base = ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile];
    // ⛔ 先比编码签名，全一致才敢 copy —— 不一致时 copy **不报错但产出坏片**（见 probeSignature 注释）
    const signatures = await Promise.all(files.map(probeSignature));
    const copySafe = signatures.every((sig) => Boolean(sig) && sig === signatures[0]);
    if (copySafe) {
      try {
        await runFfmpeg([...base, "-c", "copy", "-movflags", "+faststart", dest]);
        const stat = await fsp.stat(dest);
        if (stat.size > 0) return { path: dest, bytes: stat.size, mode: "copy", parts: files.length };
      } catch { /* 签名一致但仍 copy 失败（容器级差异）⇒ 落到下面的统一重编码 */ }
    }
    {
      // ② 统一重编码：保证任意厂商片段都能拼（也是签名不一致时的**唯一正确路径**）
      const width = Math.max(2, Math.round(Number(input?.width) || 720));
      const height = Math.max(2, Math.round(Number(input?.height) || 1280));
      const fps = Math.max(1, Math.round(Number(input?.fps) || 24));
      const filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
      await runFfmpeg([
        ...base, "-vf", filter, "-r", String(fps),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", dest,
      ]);
      const stat = await fsp.stat(dest);
      if (!stat.size) throw new Error("重编码产物为空");
      return { path: dest, bytes: stat.size, mode: "reencode", parts: files.length };
    }
  } finally {
    await fsp.unlink(listFile).catch(() => undefined);
  }
}

/** 成片文件名（同素材命名口径：剥掉路径分隔符与控制字符，限长）。 */
function safeVideoName(name: unknown): string {
  const base = String(name || "成片").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 80) || "成片";
  return /\.mp4$/i.test(base) ? base : `${base}.mp4`;
}

/* ────────────────────────────── IPC 通道（薄壳）────────────────────────────── */

export function registerVideoGen(): void {
  // ⛔ 返回面是**整个 provider 对象** + configured（渲染层的配置表单要读 fields / imageInput /
  //    defaultModel 等 —— 只回 5 个字段会让配置界面变成空白，09-29 重写时踩过又改回）
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
    //    ⛔ 必填凭证（provider.fields）同样要收 —— 只存 OPTIONAL 会让密钥保存不上（09-29 踩过）。
    for (const field of [...provider.fields, ...VIDEO_OPTIONAL_FIELDS]) values[field] = String(input?.values?.[field] ?? "").trim();
    config[provider.id] = values;
    await writeConfig(config);
    return { ok: true, configured: hasCredentials(provider.id, values) };
  });

  ipcMain.handle("video:submit", async (_event, input: { providerId: string; mode: "t2v" | "i2v"; prompt: string; image?: string; model?: string; duration?: number }) => {
    const { jobId } = await submitVideoCore(input);
    // 09-29：提交即落盘 —— 关掉画布/重启应用后任务不丢，可随时续查
    rememberVideoJob({
      jobId, providerId: String(input?.providerId ?? ""), prompt: String(input?.prompt ?? ""),
      mode: input?.mode === "i2v" ? "i2v" : "t2v", image: input?.image ? String(input.image) : undefined,
      submittedAt: Date.now(),
    });
    return { jobId };
  });

  ipcMain.handle("video:poll", async (_event, input: { providerId: string; jobId: string }) => {
    const result = await pollVideoCore(input);
    if (result.status === "succeeded" || result.status === "failed") {
      updateVideoJob(String(input?.jobId ?? ""), { status: result.status, url: result.url, error: result.error });
    }
    return result;
  });

  ipcMain.handle("video:download", async (_event, input: { url: string; workspace: string; name: string; subdir?: string }) => downloadVideoCore(input));

  // 09-29 整片导出：把分镜的各镜片段按顺序合并成一条成片（copy 优先 + 失败重编码）
  ipcMain.handle("video:concat", async (_event, input: { workspace: string; name: string; files: string[]; width?: number; height?: number; fps?: number }) => concatVideosCore(input));
}

/* ⛔⛔ 09-28 事故（用户现场：「视频生成接口一直加载中…，根本配置不了」）：
   上面把 6 个通道包在 `export function registerVideoGen()` 里，但**全仓库没有任何调用点**
   ⇒ ipcMain.handle 从未执行 ⇒ 渲染层 `invoke("video:providers")` 抛
   「No handler registered」⇒ 组件 catch 成空数组 ⇒ 卡片永远显示「加载中…」、
   弹窗里一个厂商都没有（配都没法配）。
   ⛔ 与本仓多数域不一致：其它域（fs-ipc / drama-canvas / im-channels-ipc…）都是
   **模块顶层直接 ipcMain.handle**，import 即注册。这里补一次自调用对齐该语义，
   守卫【194】同时钉死「每个 register* 导出都必须有调用点」。
   ⛔ 只在此处调用一次：Electron 对同一 channel 重复 handle 会直接抛错。 */
registerVideoGen();
