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
import { app, dialog, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { isInsideTrustedRoots, mainWindow, trustPicked } from "../runtime-refs";
import { describeProductOnce, polishPromptOnce } from "../prompt-polish";

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

/* 画布快照镜像（09-29「打通」第一步）：渲染层防抖推 {name, flow, nodes, edges}，
     主进程存 userData/drama-canvas/boards.json ⇒ workflow_read 工具能读到画布内容。 */
  ipcMain.handle("drama-canvas:board-sync", async (_event, input: { name?: unknown; flow?: unknown; nodes?: unknown; edges?: unknown }) => {
    const name = String(input?.name ?? "").trim();
    if (!name || !Array.isArray(input?.nodes)) return { ok: false };
    const root = path.join(app.getPath("userData"), "drama-canvas");
    await fs.mkdir(root, { recursive: true });
    const file = path.join(root, "boards.json");
    let all: Record<string, unknown> = {};
    try { all = JSON.parse(await fs.readFile(file, "utf8")); } catch { /* 首次 */ }
    all[name] = {
      flow: String(input?.flow ?? ""),
      nodes: input?.nodes,
      edges: input?.edges,
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(file, JSON.stringify(all, null, 2), "utf8");
    return { ok: true };
  });
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
/** 提示词润色（09-29 用户「写提示词加一个 AI 润色功能」+「不要新开会话」）：
 *  主进程用**用户已配置的模型**发一次短请求，结果就地写回卡片 —— 不开会话、不弹选择器。
 *  ⛔ 域内窄通道：渲染层只给「润色哪段文本」，模型与凭证全在主进程取（渲染层看不到 Key）。 */
ipcMain.handle("drama-canvas:polish-prompt", async (_event, input: { text: string; context?: string }) => {
  const text = String(input?.text || "").trim();
  if (!text) throw new Error("这张卡还没有提示词 —— 先写一版再润色");
  return { text: await polishPromptOnce(text, input?.context ? String(input.context) : undefined) };
});
/* 锁主体（09-29）：把「商品参考图」反推成一段固定主体描述，六类图共用 ⇒ 一套图是同一件商品。
   ⛔ 这是「参考图锁主体」在**纯文生图**通道下的可行替代（生图接口无图输入）—— 不假装能图生图。 */
/* ── 产物目录（09-29 用户：「在 codexharness 目录下面新增一个存的目录，也可以选择和修改目录」）──
   默认 <userData>/outputs：**跟着应用走**，不依赖会话工作区（画布没绑工作区时也能出图落盘）。
   ⛔ 用户显式选过 / 改过的目录要持久化；空串 = 恢复默认。选目录用系统原生对话框。 */
/* ⛔ 用**函数声明**而不是箭头 const：顶层 const 会被守卫【91】判成「模块体求值 userData」
   （main.ts 的 app.setPath("userData", …) 是模块体语句，本模块先于它加载 ⇒ 顶层取值必然拿错）。 */
function outputDirFile(): string {
  return path.join(app.getPath("userData"), "canvas-output.json");
}

export function defaultOutputDir(): string {
  return path.join(app.getPath("userData"), "outputs");
}

async function readOutputDir(): Promise<{ dir: string; isDefault: boolean }> {
  const fallback = defaultOutputDir();
  let saved = "";
  try {
    const raw = JSON.parse(await fs.readFile(outputDirFile(), "utf8"));
    saved = String(raw?.dir || "").trim();
  } catch { /* 没存过 / 文件坏了：用默认 */ }
  const dir = saved || fallback;
  await fs.mkdir(dir, { recursive: true }).catch(() => { /* 建不出来也不能让面板打不开 */ });
  return { dir, isDefault: !saved };
}

ipcMain.handle("drama-canvas:output-dir", async () => readOutputDir());

ipcMain.handle("drama-canvas:output-dir-set", async (_event, input: { dir?: string; pick?: boolean }) => {
  const current = await readOutputDir();
  let next = String(input?.dir ?? "").trim();
  if (input?.pick) {
    const picked = await dialog.showOpenDialog(mainWindow!, {
      title: "选择产物目录",
      defaultPath: current.dir,
      properties: ["openDirectory", "createDirectory"],
    }).catch(() => null);
    if (!picked || picked.canceled || !picked.filePaths?.length) return current;
    next = picked.filePaths[0];
  }
  if (!next) {
    /* 空串 = 恢复默认目录 */
    await fs.rm(outputDirFile(), { force: true }).catch(() => {});
    return readOutputDir();
  }
  if (!path.isAbsolute(next)) throw new Error("产物目录要用绝对路径（点「选择目录」最省事）");
  const resolved = path.resolve(next);
  try {
    await fs.mkdir(resolved, { recursive: true });
  } catch (error) {
    throw new Error(`这个目录不可用：${(error as Error)?.message || error}`);
  }
  /* ⛔ 必须登记为可信根：视频产物 / 其它落盘写入都要过 isInsideTrustedRoots，
      不登记的话用户选了目录也写不进去（"选了却没用"比不让选更糟）。 */
  trustPicked([resolved]);
  await fs.writeFile(outputDirFile(), JSON.stringify({ dir: resolved }, null, 2), "utf8");
  return { dir: resolved, isDefault: false };
});

ipcMain.handle("drama-canvas:describe-image", async (_event, input: { image: string; context?: string }) => {
  const image = String(input?.image || "").trim();
  if (!image) throw new Error("这张卡还没有参考图 —— 先在「商品参考图」卡上传一张");
  return { text: await describeProductOnce(image, input?.context ? String(input.context) : undefined) };
});
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
