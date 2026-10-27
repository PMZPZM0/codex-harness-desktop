/**
 * OpenFilm 的**模型工具面**（10-27 批次二，P3）。
 *
 * 六个工具（都走宿主 dynamicTools，⛔ 不做成 MCP —— 引擎 0.157 起内置 MCP 整批"延迟暴露"）：
 *   openfilm_status / openfilm_make_film / openfilm_check / openfilm_render / openfilm_get / openfilm_skill
 *
 * ── 为什么在**主进程**应答（而不是渲染层）──────────────────────────────────
 * 同 `delegate-harness-tool`：后台跑的会话（专家 / 专家团 / 子智能体）不在渲染层"正在看着"的列表里，
 * 它的 `item/tool/call` 会被 `renderer-fuse` 裁掉 ⇒ 渲染层根本收不到。OpenFilm 的命令全在主进程
 * （spawn CLI），放这里让**前台会话与后台会话走同一条路**，少一处会漏的地方。
 *
 * ── 三条硬闸 ──────────────────────────────────────────────────────────────
 *   ① **命令白名单**：只有 open/look/render/get/skills/skill（`runner.CLI_VERBS`）；
 *      `update` / `doctor` 不给模型（会自己改运行时、或只是体检）。
 *   ② **目录闸**：`filmDir` 必须在会话工作区之内，且不是 home / 盘根 / `~/.openfilm` /
 *      我们的安装目录 —— ⛔ 否则一次 `render --out` 就能写到用户任何地方。
 *   ③ **产物只回路径**：`render` 可能是几百 MB，⛔ 绝不读进内存回给模型（既有纪律：图片/产物一律落盘）。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { threadCwd } from "../runtime-refs";
import { cliEntry, cliVersion, filmsRootFor, openfilmRoot, studioHome } from "./paths";
import { openfilmStatus } from "./probe";
import { runCli, verbTimeout } from "./runner";
import { openStudio } from "./studio";
import { desktopInfo, desktopSummary } from "./desktop";
import { OPENFILM_HOME, OPENFILM_LICENSE } from "./brand";

/* ── 工具定义 ───────────────────────────────────────────────────────────── */

/** `frame(t)` 契约的浓缩版（模型不读文档也知道红线；全文在上游 MANUAL.md，`openfilm_skill` 可读）。 */
export const FILM_RULES = [
  "影片 = 一个目录：`film.html` 是剪辑表，每个镜头是一页 `*.html`（暴露 `window.film.frame(t)`），素材放 `assets/`。",
  "铁律：画面**只依赖 t**（同一个 t 永远画出同一幅图；不许自播动画、不许动画循环），否则渲染出来乱序/抖动。",
  "每条 `<section>` 是一条轨（上面压下面）；片段是 `<iframe>/<video>/<img>/<audio>`，用 `src=...#t=in,out` + `at=` + `style` 定位。",
  "⛔ 不重编码素材：切长片就复用同一个文件、改 `#t=`；裁切交给 CSS（`object-fit`），不许 ffmpeg 切出新文件。",
  "⛔ 不动 `overrides`（用户在 Studio 里的手改）与 `locked` 轨；字幕一律 `.vtt` 与素材同名，不要在页面里画字幕。",
].join("\n");

export function buildOpenfilmTools(): any[] {
  return [
    {
      type: "function",
      name: "openfilm_status",
      description:
        "查 OpenFilm（第三方开源视频剪辑工具）在这台机器上的状态：装没装、渲染引擎/ffmpeg 就绪没、"
        + "Studio 连接是否活着、配置文件在哪。用户提到「剪视频 / 做个片子 / 口播 / 字幕 / 封面动效」时**先用它**判断下一步。"
        + "⛔ 没装就引导用户到「设置 → 开发工具 → OpenFilm 视频剪辑」点一次「下载并安装」，**不要自己 npm install**。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "openfilm_make_film",
      description:
        "开一部片子并把 Studio 打开在用户的内置浏览器里（这就是「连接/配对」：同一个 Studio 实例 + 同一个目录）。"
        + "新片会得到 `<工作区>/films/<名字>/`，里面自动生成空的 `film.html`。"
        + "⛔ 必须先 openfilm_status 确认已就绪；未就绪时本工具会告诉你让用户去点安装。"
        + "返回后**接着写** `film.html` 与镜头页（不是先问用户）。",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "影片目录名（不传就按 brief 生成一个短名）" },
          brief: { type: "string", description: "这部片要做什么（一句话；用来生成目录名与后续规划）" },
          dir: { type: "string", description: "显式的影片目录（相对路径按当前工作区解析）；一般不用传" },
        },
        required: [],
      },
    },
    {
      type: "function",
      name: "openfilm_check",
      description:
        "校验片子：整片联系表 + 声音 + 「同一个 t 是否画出同一幅图」的确定性自检（`openfilm look`）。"
        + "改完 film.html / 镜头页**必须**跑它；有问题按返回项修，两次不过就停下把问题交给用户。"
        + "传 `at` 只看一处：`4.5` 一帧、`3-6` 一段、`assets/a.mp4` 单个素材。",
      inputSchema: {
        type: "object",
        properties: {
          filmDir: { type: "string", description: "影片目录（省略 = 当前工作区里最近改过的片子）" },
          at: { type: "string", description: "单帧（秒）/区间 `3-6` /素材相对路径；省略 = 整片" },
        },
        required: [],
      },
    },
    {
      type: "function",
      name: "openfilm_render",
      description:
        "导出 MP4（默认 30fps，落在 film.html 旁边）。⛔ 只在用户**开口要文件**时调；导出前先 openfilm_check。"
        + "返回产物绝对路径（不返回二进制内容）。大分辨率/长片很慢，别循环重试。",
      inputSchema: {
        type: "object",
        properties: {
          filmDir: { type: "string", description: "影片目录（省略 = 当前工作区里最近改过的片子）" },
          range: { type: "string", description: "只导一段：`3-6`（秒）；省略 = 整片" },
          fps: { type: "number", description: "帧率 1~240（缺省 30）" },
          out: { type: "string", description: "输出文件名（相对影片目录）；省略 = 与 film.html 同级" },
          fourK: { type: "boolean", description: "4K 导出" },
          alpha: { type: "boolean", description: "带透明通道（webm/部分容器）" },
          subtitles: { type: "boolean", description: "烧入字幕（来自素材同名 .vtt）" },
          blur: { type: "boolean", description: "补帧间运动模糊" },
        },
        required: [],
      },
    },
    {
      type: "function",
      name: "openfilm_get",
      description:
        "取素材：配音 / 音乐 / 音效 / 转写 / 图片 / 图搜 / 视频与网页搜索（`openfilm get`）。"
        + "⚠️ 每一种都要求用户**先在 Studio 里连了对应服务并给了自己的 key**；没连就会原样回上游的提示，"
        + "你要照着说明告诉用户去连哪个服务（Studio → Settings → Providers），⛔ 不要编造素材。"
        + "不带参数调用 = 列出这台机器现在能用哪些。",
      inputSchema: {
        type: "object",
        properties: {
          args: {
            type: "array", items: { type: "string" },
            description: "传给 get 的参数，按原顺序：动词 + 文本 + 选项（如 [\"voice-over\", \"欢迎收看\", \"--via\", \"elevenlabs\"]）。"
              + "允许的选项：--yes --via --model --count --duration --lang --style",
          },
          filmDir: { type: "string", description: "影片目录（省略 = 当前工作区里最近改过的片子）" },
        },
        required: [],
      },
    },
    {
      type: "function",
      name: "openfilm_skill",
      description:
        "读 OpenFilm 自带的**拍摄手法**技能（collage / keynote / long-to-short / lyric-video 等）："
        + "用户点名某种片型、或某种片型明显更合适时，先读它再动手（`openfilm skill <name>` 打印正文，"
        + "不带参数 = 列出可用技能）。⛔ 只读，不许改上游技能内容。",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "技能名（省略 = 列出全部可用技能）" } },
        required: [],
      },
    },
  ];
}

/* ── 目录闸 / 参数闸 ────────────────────────────────────────────────────── */

const MAX_TOKENS = 24;

/** 允许传给 `get` 的选项（⛔ 其余 `-` 开头的 token 一律拒，别让模型把命令行当自由文本）。 */
const GET_FLAGS = new Set(["--yes", "--via", "--model", "--count", "--duration", "--lang", "--style"]);

type DirGate = { ok: true; dir: string; notes: string[] } | { ok: false; error: string };

/** 影片目录必须：绝对化后落在工作区之内，且不是 home / 盘根 / Studio home / 我们的安装根。 */
export function resolveFilmDir(raw: string, workspace: string): DirGate {
  const notes: string[] = [];
  const base = String(workspace ?? "").trim() || os.homedir();
  const input = String(raw ?? "").trim();
  if (!input) return { ok: false, error: "缺少影片目录（filmDir）" };
  const dir = path.resolve(base, input);
  if (!path.isAbsolute(dir)) return { ok: false, error: `影片目录不是绝对路径：${input}` };

  const blocked: Array<[string, string]> = [
    [os.homedir(), "用户主目录"],
    [path.parse(dir).root, "磁盘根目录"],
    [studioHome(), "Studio 自己的状态目录（~/.openfilm）"],
    [openfilmRoot(), "OpenFilm 的安装目录"],
  ];
  for (const [target, label] of blocked) {
    if (!target) continue;
    const same = path.resolve(dir) === path.resolve(target);
    const inside = path.resolve(dir).startsWith(path.resolve(target) + path.sep);
    /* home / 盘根只拒"就是这个目录"；Studio home 与安装根连子目录一起拒 */
    const isHard = label !== "用户主目录" && label !== "磁盘根目录";
    if (same || (isHard && inside)) return { ok: false, error: `不能拿${label}当影片目录：${dir}` };
  }
  /* 工作区闸：允许工作区本身及其子目录（影片默认就在 <工作区>/films 下） */
  const inWorkspace = path.resolve(dir) === path.resolve(base) || path.resolve(dir).startsWith(path.resolve(base) + path.sep);
  if (!inWorkspace) {
    return { ok: false, error: `影片目录必须在当前工作区（${base}）之内：${dir}\n要放在别处，请让用户自己建目录或调整会话工作区` };
  }
  if (/\s/.test(dir)) notes.push("路径含空格：上游 0.2.6 起已支持，但失败时优先怀疑这里（可在卡片里换成无空格目录）");
  return { ok: true, dir, notes };
}

/** 「当前工作区里最近改过的片子」—— 不传 filmDir 时用（只在工作区里找，不扫全盘）。 */
function latestFilmIn(workspace: string): string {
  const roots = [path.join(workspace, "films"), workspace];
  let best = "";
  let bestAt = 0;
  for (const root of roots) {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const film = path.join(root, entry.name, "film.html");
      try {
        const at = fs.statSync(film).mtimeMs;
        if (at > bestAt) { bestAt = at; best = path.join(root, entry.name); }
      } catch { /* 不是影片目录 */ }
    }
    if (best) break;
  }
  return best;
}

/** 一串 token 的清洗：挡空值/超长/换行，`get` 的 `-` 选项走白名单。 */
function cleanTokens(raw: unknown, allowFlags: boolean): { ok: true; tokens: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, tokens: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "args 必须是字符串数组" };
  if (raw.length > MAX_TOKENS) return { ok: false, error: `参数太多（最多 ${MAX_TOKENS} 个）` };
  const tokens: string[] = [];
  for (const item of raw) {
    const token = String(item ?? "").trim();
    if (!token) continue;
    if (token.length > 200 || /[\r\n\t]/.test(token)) return { ok: false, error: `参数不合法：${token.slice(0, 40)}` };
    if (token.startsWith("-")) {
      if (!allowFlags || !GET_FLAGS.has(token)) return { ok: false, error: `不支持的选项：${token}` };
    }
    tokens.push(token);
  }
  return { ok: true, tokens };
}

/* ── 执行 ───────────────────────────────────────────────────────────────── */

function text(t: string) { return { type: "inputText", text: t }; }

/** 目录名清洗：与上游 `folderName()` 同口径（去掉文件系统不认的字符），再补一个短后缀避免重名。 */
function slugOf(input: string): string {
  const clean = String(input ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .slice(0, 40)
    .trim();
  return clean || `film-${new Date().toISOString().slice(0, 10)}`;
}

/** 未就绪时的统一回话（模型据此去找用户，而不是自己装）。 */
function notReadyText(status: Awaited<ReturnType<typeof openfilmStatus>>): string {
  const missing: string[] = [];
  if (!status.cli.installed) missing.push("命令行（npm 包 openfilm）");
  if (!status.browser.installed) missing.push("渲染引擎（Chromium ≈100MB）");
  if (!status.ffmpeg.ok) missing.push("ffmpeg");
  return `OpenFilm 还没就绪，缺：${missing.join("、")}。\n`
    + `请让用户打开「设置 → 开发工具 → OpenFilm 视频剪辑」，点一次「下载并安装」（约 100MB，装一次即可），装完再继续。\n`
    + `⛔ 不要自己执行 npm install / 不要让用户去命令行装。`;
}

async function toolStatus(): Promise<string> {
  const status = await openfilmStatus();
  /* ⛔ 3 秒上限：模型调 status 是为了"现在能不能干活"，不能因为 GitHub API 慢（三候选各 12s）
     把工具卡住。超时就当没有这条附加信息。 */
  const desktopLine = await Promise.race([
    desktopInfo().then((info) => desktopSummary(info)).catch(() => ""),
    new Promise<string>((resolve) => { setTimeout(() => resolve(""), 3000).unref?.(); }),
  ]);
  const lines = [
    `状态：${status.phase === "ready" ? "就绪" : status.phase === "broken" ? "装了一半（缺渲染引擎或 ffmpeg）" : status.phase === "installing" ? "安装中" : "未安装"}`,
    `CLI：${status.cli.version || "未安装"}${status.cli.path ? `（${status.cli.path}）` : ""}`,
    `Node：${status.node.version || "缺失"}${status.node.embedded ? "（内置）" : ""}`,
    `渲染引擎：${status.browser.installed ? "就绪" : "未下载"}`,
    `ffmpeg：${status.ffmpeg.ok ? status.ffmpeg.version : "缺失（look / render 会失败）"}`,
    `Studio：${status.studio.alive ? `在跑 · ${status.studio.url || status.studio.origin}${status.studio.projectPath ? ` · 当前影片 ${status.studio.projectPath}` : ""}` : "没连上（openfilm_make_film 会启动它）"}`,
    `自动更新：${status.settings.autoUpdate} · 下载源：${status.settings.mirror === "official" ? "仅官方" : "国内镜像优先"}`,
    /* 桌面端一句话（用户：「有桌面端会更方便」）—— 让模型能主动建议，而不是等用户自己找设置。
       ⛔ 失败静默：这是一条附加信息，⛔ 不许因为 GitHub API 读不到就让整个 status 失败。 */
    desktopLine,
    `开源：${OPENFILM_HOME}（${OPENFILM_LICENSE}；名称与图标为该项目商标，本产品与其无隶属关系）`,
  ];
  if (status.phase !== "ready") lines.push("", notReadyText(status));
  return lines.join("\n");
}

async function toolMakeFilm(args: any, workspace: string): Promise<{ ok: boolean; text: string }> {
  const status = await openfilmStatus();
  if (status.phase !== "ready") return { ok: false, text: notReadyText(status) };

  const rawDir = String(args.dir ?? "").trim();
  const name = String(args.name ?? "").trim();
  const brief = String(args.brief ?? "").trim();
  const target = rawDir || path.join(filmsRootFor(workspace) || path.join(workspace, "films"), slugOf(name || brief));
  const gate = resolveFilmDir(target, workspace);
  if (!gate.ok) return { ok: false, text: gate.error };

  try { fs.mkdirSync(gate.dir, { recursive: true }); } catch (error: any) {
    return { ok: false, text: `建目录失败：${gate.dir}（${String(error?.message ?? error)}）` };
  }
  const opened = await openStudio({ filmDir: gate.dir, cwd: workspace });
  if (!opened.ok) return { ok: false, text: `${opened.code ?? "OF_E_STUDIO"} ${opened.error ?? "Studio 打开失败"}` };

  const lines = [
    `影片已就位：${opened.projectPath || gate.dir}`,
    opened.url ? `Studio：${opened.url}` : "Studio：已启动但没有拿到页面地址",
    opened.note ? `上游提示：${opened.note}` : "",
    gate.notes.length ? `注意：${gate.notes.join("；")}` : "",
    "",
    "接下来（按顺序，不要先问用户）：",
    "1) 读 `film.html`（Studio 已建好空片），按需求写镜头页 `*.html`（每页暴露 `window.film.frame(t)`）并组织 `<section>` 轨；",
    "2) 调 `openfilm_check` 自检（整片联系表 + 确定性）；有问题按返回项修，两次不过就停下把问题交给用户；",
    "3) 用户开口要文件时才 `openfilm_render`。",
    "",
    "红线（违反必然出问题）：",
    FILM_RULES,
  ].filter(Boolean);
  return { ok: true, text: lines.join("\n") };
}

async function toolCheck(args: any, workspace: string): Promise<{ ok: boolean; text: string }> {
  const filmDir = String(args.filmDir ?? "").trim() || latestFilmIn(workspace);
  const gate = resolveFilmDir(filmDir, workspace);
  if (!gate.ok) return { ok: false, text: gate.error };
  const at = String(args.at ?? "").trim();
  /* ⛔ at 只接受「单帧 / 区间 / 素材相对路径」三种形状：别让它变成一枚自由 flag（模型会写 --fps 60 之类） */
  if (at && (!/^[\w./\- ]{1,120}$/.test(at) || at.startsWith("-"))) {
    return { ok: false, text: `at 只接受 4.5 / 3-6 / assets/a.mp4 这类值（收到 ${at.slice(0, 40)}）` };
  }
  const result = await runCli(cliEntry(), ["look", ...(at ? [at] : [])], { verb: "look", cwd: gate.dir });
  const body = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n").slice(-6000);
  /* ⛔ 用 runner 的真实超时值，别在这里再写一个字面量（改超时就会对不上） */
  if (result.timedOut) return { ok: false, text: `校验超时（${Math.round(verbTimeout("look") / 1000)}s）：${body}` };
  if (result.code !== 0) return { ok: false, text: `校验失败（退出码 ${result.code}）：\n${body}` };
  return { ok: true, text: `校验通过（${gate.dir}）\n${body}` };
}

async function toolRender(args: any, workspace: string): Promise<{ ok: boolean; text: string }> {
  const filmDir = String(args.filmDir ?? "").trim() || latestFilmIn(workspace);
  const gate = resolveFilmDir(filmDir, workspace);
  if (!gate.ok) return { ok: false, text: gate.error };

  const range = String(args.range ?? "").trim();
  const out = String(args.out ?? "").trim();
  const fps = Number(args.fps ?? 0);
  if (fps && (fps < 1 || fps > 240)) return { ok: false, text: `fps 必须在 1~240（收到 ${fps}）` };
  if (out && path.isAbsolute(out)) return { ok: false, text: "out 只接受相对影片目录的文件名（⛔ 不许写任意路径）" };
  if (out && out.includes("..")) return { ok: false, text: "out 里不许出现 `..`" };

  const argv = ["render", ...(range ? [range] : [])];
  if (fps) argv.push("--fps", String(fps));
  if (args.fourK) argv.push("--4k");
  if (args.alpha) argv.push("--alpha");
  if (args.subtitles) argv.push("--subtitles");
  if (args.blur) argv.push("--blur");
  if (out) argv.push("--out", out);

  const before = newestMp4(gate.dir);
  const result = await runCli(cliEntry(), argv, { verb: "render", cwd: gate.dir });
  const body = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n").slice(-4000);
  if (result.timedOut) return { ok: false, text: `导出超时（15 分钟）：\n${body}\n可只导一段（range）或降低 fps 重试一次。` };
  if (result.code !== 0) return { ok: false, text: `导出失败（退出码 ${result.code}）：\n${body}` };

  /* 产物路径：优先信上游打印的 .mp4，其次看目录里最新的（改了 mtime 的那个）。⛔ 只回路径。 */
  const printed = /(\S+\.mp4)\b/.exec(result.stdout)?.[1] ?? "";
  const produced = printed ? path.resolve(gate.dir, printed) : newestMp4(gate.dir) || before;
  if (!produced) return { ok: false, text: `导出命令成功了，但没找到 .mp4 产物：\n${body}` };
  try {
    const size = fs.statSync(produced).size;
    return { ok: true, text: `导出完成：${produced}\n大小：${(size / 1024 / 1024).toFixed(1)} MB\n${body ? `上游输出：\n${body}` : ""}`.trim() };
  } catch {
    return { ok: true, text: `导出完成（产物路径由上游报告）：${produced}` };
  }
}

/** 目录里最新的 .mp4（只看顶层，不递归 —— 素材目录里的原件不该被当产物）。 */
function newestMp4(dir: string): string {
  let best = "";
  let bestAt = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.mp4$/i.test(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const at = fs.statSync(full).mtimeMs;
      if (at > bestAt) { bestAt = at; best = full; }
    }
  } catch { /* 目录读不到就不给路径 */ }
  return best;
}

async function toolGet(args: any, workspace: string): Promise<{ ok: boolean; text: string }> {
  const cleaned = cleanTokens(args.args, true);
  if (!cleaned.ok) return { ok: false, text: cleaned.error };
  const filmDir = String(args.filmDir ?? "").trim() || latestFilmIn(workspace);
  const gate = resolveFilmDir(filmDir, workspace);
  if (!gate.ok) return { ok: false, text: gate.error };
  const result = await runCli(cliEntry(), ["get", ...cleaned.tokens], { verb: "get", cwd: gate.dir });
  const body = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n").slice(-6000);
  if (result.timedOut) return { ok: false, text: `取素材超时：\n${body}` };
  /* 退出码 2 = 不是项目 / 命令用错；1 = 没跑成（常见：服务没连）⇒ 上游的提示原样转述，别自己编。 */
  return { ok: result.code === 0, text: body || (result.code === 0 ? "完成（上游没有输出）" : `失败（退出码 ${result.code}）：没有输出`) };
}

async function toolSkill(args: any, workspace: string): Promise<{ ok: boolean; text: string }> {
  const name = String(args.name ?? "").trim();
  const cleaned = cleanTokens(name ? [name] : [], false);
  if (!cleaned.ok) return { ok: false, text: cleaned.error };
  const filmDir = latestFilmIn(workspace) || workspace;
  const result = await runCli(cliEntry(), [name ? "skill" : "skills", ...cleaned.tokens], { verb: name ? "skill" : "skills", cwd: filmDir });
  const body = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n").slice(-12_000);
  if (result.code !== 0 && !body) return { ok: false, text: `读取技能失败（退出码 ${result.code}）` };
  return { ok: true, text: body || "（上游没有输出）" };
}

/* ── 主进程应答（boot.ts 在事件流里调用） ───────────────────────────────── */

export async function handleOpenfilmToolCall(input: {
  event: { id?: string | number; method?: string; params?: any };
  respond: (id: string | number, result: unknown) => void;
}): Promise<boolean> {
  const { event, respond } = input;
  if (String(event?.method ?? "") !== "item/tool/call") return false;
  const tool = String(event?.params?.tool ?? "");
  if (!tool.startsWith("openfilm_")) return false;
  const id = event?.id;
  if (id === undefined || id === null) return false;

  const args = (() => {
    const raw = event?.params?.arguments;
    if (typeof raw === "string") { try { return JSON.parse(raw) as any; } catch { return {} as any; } }
    return (raw && typeof raw === "object") ? raw as any : {} as any;
  })();
  /* 工作区只认引擎下发的 threadId（模型伪造不了）—— 目录闸的根就在它上面。 */
  const threadId = String(event?.params?.threadId ?? "");
  const workspace = String(threadCwd.get(threadId) ?? "").trim();

  const reply = (ok: boolean, result: { ok: boolean; text: string }) =>
    respond(id, { contentItems: [text(result.text)], success: ok && result.ok });

  try {
    if (!cliVersion() && tool !== "openfilm_status") {
      reply(false, { ok: false, text: notReadyText(await openfilmStatus()) });
      return true;
    }
    if (!workspace && tool !== "openfilm_status") {
      reply(false, { ok: false, text: "拿不到当前会话的工作区，无法定位影片目录：请让用户在新会话里重试，或先打开一个项目。" });
      return true;
    }
    switch (tool) {
      case "openfilm_status": {
        const body = await toolStatus();
        reply(true, { ok: true, text: body });
        return true;
      }
      case "openfilm_make_film": {
        const result = await toolMakeFilm(args, workspace);
        reply(result.ok, result);
        return true;
      }
      case "openfilm_check": {
        const result = await toolCheck(args, workspace);
        reply(result.ok, result);
        return true;
      }
      case "openfilm_render": {
        const result = await toolRender(args, workspace);
        reply(result.ok, result);
        return true;
      }
      case "openfilm_get": {
        const result = await toolGet(args, workspace);
        reply(result.ok, result);
        return true;
      }
      case "openfilm_skill": {
        const result = await toolSkill(args, workspace);
        reply(result.ok, result);
        return true;
      }
      default:
        return false;      // 不是本批工具，交回原流程
    }
  } catch (error: any) {
    reply(false, { ok: false, text: `OpenFilm 工具执行异常：${String(error?.message ?? error)}` });
    return true;
  }
}
