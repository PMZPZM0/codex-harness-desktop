/**
 * drama-canvas 域的 IPC handler（无限画布的**二进制素材写入**）。
 *
 * 为什么需要它：渲染层唯一的文件写入通道 `fs:write` 是 **utf8 字符串**写
 * （`fs.writeFile(resolved, content, "utf8")`），写不了 WAV/PNG 这类二进制 ——
 * 拿它写音频会被当文本编码，出来是一堆替换字符。所以本地 TTS 生成的配音要落盘，
 * 必须有一条能收 base64 并按字节写的通道。
 *
 * 安全口径与 `fs-ipc.ts` **完全同源**（09-19 审计后收敛过的那套）：
 *   · 目录一律由主进程自己拼（渲染层只给"哪个工作区 + 叫什么名"），不接受现成路径；
 *   · 工作区必须落在 `isInsideTrustedRoots` 认可的可信根内（各会话工作目录 / userData / 用户选过的路径）；
 *   · 文件名净化（去掉路径分隔符与 ..）+ 扩展名白名单 + 体积上限 —— 不给"任意路径写文件"留口子。
 *
 * 跨域取用：`isInsideTrustedRoots` 从 `../runtime-refs`（叶子模块）取，不在模块顶层求值任何路径。
 */
import { app, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { isInsideTrustedRoots } from "../runtime-refs";

/** 画布域的工作区目录：与分镜表同一棵树，用户拷走工作区就带走了全部产物 */
const ROOT_DIR = ".drama-canvas";
const ASSET_DIR = "assets";
/** 单文件体积上限。配音 WAV 秒级只有几百 KB；留 64MB 给视频片段，超过基本是误传。 */
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
/** 允许落地的素材类型（白名单，不给"写个 .exe 进去"的机会）。 */
const ASSET_EXT = /\.(wav|mp3|m4a|flac|png|jpe?g|webp|gif|avif|mp4|webm|mov)$/i;

/** 文件名净化：去掉任何路径成分与 Windows 非法字符，空名兜底。 */
export function safeAssetName(raw: string): string {
  const base = path.basename(String(raw || "").replace(/\\/g, "/"));
  const cleaned = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim();
  return cleaned || "asset.bin";
}

/** 子目录净化：只留一级、去分隔符（防 `../../` 逃逸）。 */
export function safeSubdir(raw: string): string {
  const cleaned = String(raw || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/^\.+/, "").trim();
  return cleaned.slice(0, 40);
}

ipcMain.handle("drama-canvas:asset-write", async (_event, input: { workspace: string; name: string; base64: string; subdir?: string }) => {
  const requested = String(input?.workspace || "").trim();
  const resolved = requested ? path.resolve(requested) : "";
  /* ⛔⛔ 09-29 用户实测「参考图传不了」（报错：只允许把素材写进会话工作区或应用数据目录）：
     可信根 = userData + **活着的会话 workdir** + 用户亲自选过的路径 ⇒ 画布一旦脱离活会话
     （重启应用 / 会话已关），它的 workspace 就掉出可信根，上传**必然**被拒。
     素材是暂存物、不是用户工作产物 ⇒ 白名单不通过时**回退应用数据目录**（错误文案本来就写着
     「或应用数据目录」，说明这是设计意图），并返回 fallback 标记 —— ⛔ 不许静默回退：
     静默会让人以为写进了工作区，之后找不到文件。 */
  const trusted = Boolean(resolved) && isInsideTrustedRoots(resolved);
  const base = trusted ? resolved : path.join(app.getPath("userData"), "drama-canvas-assets");
  const sub = safeSubdir(input?.subdir || "");

  const name = safeAssetName(input?.name);
  if (!ASSET_EXT.test(name)) throw new Error(`不支持的素材格式：${path.extname(name) || "（无扩展名）"}。只支持音频、图片与视频文件。`);

  const buffer = Buffer.from(String(input?.base64 || ""), "base64");
  if (!buffer.length) throw new Error("素材内容为空，没有写入");
  if (buffer.length > MAX_ASSET_BYTES) throw new Error(`素材过大（${(buffer.length / 1048576).toFixed(1)}MB），单文件上限 ${MAX_ASSET_BYTES / 1048576}MB`);

  const dir = trusted ? path.join(base, ROOT_DIR, ASSET_DIR, sub) : path.join(base, sub);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, name);
  await fs.writeFile(target, buffer);
  return { path: target, fallback: !trusted };
});

/** 删分镜表的**工作区文件**（09-29 项目管理）。
 *  ⛔ 域内窄通道，不是通用文件删除：目标由主进程自己拼（<workspace>/.drama-canvas/storyboards/<name>.json），
 *  渲染层只给「哪个工作区 + 叫什么名」；只删这一个 .json **文件**（目录一律拒绝）；
 *  文件不存在时幂等返回 removed:false，不抛（删除按钮重跑不会报错）。 */
ipcMain.handle("drama-canvas:storyboard-file-remove", async (_event, input: { workspace: string; name: string }) => {
  const workspace = path.resolve(String(input?.workspace || ""));
  if (!workspace) return { removed: false };
  if (!isInsideTrustedRoots(workspace)) throw new Error("只允许操作会话工作区或应用数据目录");
  const safe = String(input?.name || "main").replace(/[\\/:*?"<>|]/g, "_").replace(/.json$/i, "") || "main";
  const target = path.join(workspace, ROOT_DIR, "storyboards", `${safe}.json`);
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return { removed: false };
  if (!stat.isFile()) throw new Error("目标不是文件，拒绝删除");
  await fs.unlink(target);
  return { removed: true };
});
