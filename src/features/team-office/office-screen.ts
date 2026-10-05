/**
 * 显示器内容 · Canvas 逐帧绘制
 *
 * 立 2026-10-04 ／ 修 10-05 上午（坐标画在椅背上 + 待机=熄屏）
 * ／ 升级 10-05 晚（真实事件面 + 20 种画面）
 *
 * ⛔ 用户报「显示器内容像一张图，没有 CSS 动画」—— 真因：背景图 `bg.webp` 把六个显示器
 *   **烙死**了，只有角色是动态的。⇒ 在角色之前，**按每个座位叠画动态内容区**。
 *
 * ⛔⛔ 10-05 上午用户再报「显示器都还是固定的、你做的那个显示没对准、没显示」——
 *   两层原因（两个都已修）：① `SEATS[].screen` 的坐标扫到了**椅背**上（椅背随后会被重贴
 *   盖回人物 ⇒ 画上去的内容被整块盖掉）；② `idle` 被当成 `off` 画成静态色块。
 *
 * ⛔⛔ 10-05 晚用户报「事件状态反馈未接通，操作后没有任何响应」+「丰富显示器内容，
 *   把对话框里出现的所有事件都接进来」—— 根因是上游给的是**编造的三布尔**
 *   （`thinking/waiting/reporting`），表达不了"有产出 / 已完成 / 已失败"，
 *   也表达不了"此刻在打开浏览器还是改文件"。现在两层输入都是真实的：
 *
 *   ① **运行阶段 `RunPhase`**（宿主按 run 记录推导：status / output / 起止时间 / error）
 *      ⇒ 决定"这条命是刚开工、在写、还是已经完成/失败"；
 *   ② **事件种类 `OfficeActivityKind`**（`office-activity.ts` 按引擎 item 事件分类，
 *      与对话框同一套判据）⇒ 决定"此刻屏幕上该演什么画面"。
 *
 * ┌ 模式 ────────┬ 触发条件（全部来自真实数据，⛔ 没有一个是编的）─────────────────────┐
 * │ off          │ 座位上没人                                                           │
 * │ away         │ 离席（接水/洗手间/跑步/举铁）                                        │
 * │ search       │ 离席去书架查资料 **或** 真实 `webSearch` 事件                        │
 * │ browser      │ 真实事件：命令里启动浏览器 / 浏览器类 MCP 工具                       │
 * │ file-write   │ 真实事件：fileChange 全是新增行（新建文件）                          │
 * │ file-edit    │ 真实事件：fileChange 带删除行（修改文件）                            │
 * │ file-search  │ 真实事件：命令意图 = 搜索（grep / Select-String / rg…）              │
 * │ file-read    │ 真实事件：命令意图 = 查看（cat / Get-Content / git diff…）           │
 * │ terminal     │ 真实事件：跑命令 / 构建 / 测试                                       │
 * │ service      │ 真实事件：MCP / 动态工具调用（非浏览器类）                            │
 * │ collab       │ 真实事件：协作分派                                                   │
 * │ thinking     │ 阶段 = 运行中且尚无产出；或真实 reasoning 事件                        │
 * │ wait         │ 阶段 = 运行中、超过 WAIT_AFTER_MS 仍无产出                            │
 * │ code         │ 阶段 = 运行中、产出还短（< REPORT_CHARS）                            │
 * │ report       │ 阶段 = 运行中、产出已成稿 ⇒ 柱子按**真实产出字数**增长                 │
 * │ done/failed  │ 最近一次运行成功/失败 ⇒ ✓ / ✗ + 真实用时                             │
 * │ idle         │ 在座、无事件 ⇒ **屏保轮播**（时钟 / 电视剧 / 游戏，见 screensaverMode）│
 * │ video / game │ 上面那个轮播的后两档 —— 即用户说的"摸鱼时看剧 / 打游戏"                 │
 * └──────────────┴─────────────────────────────────────────────────────────────────────┘
 *
 * ⛔ 为什么用原生 canvas 逐帧、而不是 CSS 动画：
 *   像素风要 `imageSmoothingEnabled=false` 的最近邻放大；内容是"代码行/光标"这类
 *   逐帧变化的小图形，CSS 做要一堆 div + 动画帧同步，反而更重也更难和人物动画对齐。
 *
 * ⛔ 坐标来自 `office-format.ts` 的 `SEATS[].screen`。改这里先改那边。
 */
import type { OfficeActivityKind } from "./office-activity";

/**
 * 一次委托的**真实阶段**（由宿主从 run 记录推导，见 `TeamOfficePreview.phaseOfRun`）。
 * ⛔⛔ 不要退回"三个布尔"那种形态：`thinking/waiting/reporting` 无法表达
 *   "有产出 / 已完成 / 已失败"，而这三件事恰好是用户最想看到的反馈。
 */
export type RunPhase =
  /** 没有可用的运行信息（没跑过 / 完成反馈已过期） ⇒ 走屏保 */
  | "none"
  /** 运行中、尚无产出 */
  | "thinking"
  /** 运行中、尚无产出且已超 `WAIT_AFTER_MS`（长时间没动静） */
  | "waiting"
  /** 运行中、产出还短 ⇒ 正在写 */
  | "writing"
  /** 运行中、产出已成稿（≥ `REPORT_CHARS`） */
  | "reporting"
  /** 最近一次成功完成 */
  | "done"
  /** 最近一次失败 */
  | "failed";

/** 一个屏幕的状态机。20 种，每一种都有真实触发条件（见文件头对照表）。 */
export type ScreenMode =
  | "off" | "idle" | "away" | "code" | "thinking" | "search" | "wait" | "report" | "done" | "failed"
  | "browser" | "file-write" | "file-search" | "file-read" | "file-edit" | "terminal" | "service" | "collab"
  | "video" | "game";

/** 传给绘制层的**真实信息**（顶栏 / 滚动字幕 / 进度条就靠它，⛔ 不画假数字）。 */
export type ScreenInfo = {
  /** 当前阶段或当前事件已持续毫秒（0/undefined ⇒ 顶栏不显示计时） */
  elapsedMs?: number;
  /** 本轮**真实产出字数**（report 模式的进度条按它增长） */
  chars?: number;
  /** **真实事件细节**（命令 / 文件名 / 查询词）⇒ 屏面底部滚动字幕 */
  detail?: string;
};

/** 产出超过这么多字符 ⇒ 视为"已成稿"（走 report 而不是 code）。 */
export const REPORT_CHARS = 600;
/** 运行中、超过这么久仍无产出 ⇒ 视为"长时间无输出"（走 wait）。 */
export const WAIT_AFTER_MS = 8000;
/** 完成/失败反馈保留这么久，之后回到屏保（在**映射层**判，见 `effectivePhase`）。 */
export const DONE_HOLD_MS = 60000;
/** 屏保轮播每一档持续多少秒（时钟 → 电视剧 → 游戏）。 */
export const SCREENSAVER_SLOT_S = 14;

/** 屏幕配色（与背景图的像素风一致：低饱和、无渐变）。 */
const PAL = {
  offBg: "#1b2530",
  offGlow: "#26313d",
  /* 待机时钟：底色比 off 略亮（"开着但闲着"），字用冷白不抢戏 */
  idleBg: "#141c26",
  idleNum: "#6f9dc4",
  idleBar: "#2c4661",
  /* 离席：比 idle 更暗一档 */
  awayBg: "#10161e",
  awayDot: "#2b3d52",
  awaySweep: "rgba(122,160,196,0.10)",
  /* 顶栏（所有非 off 屏共用）：深底 + 模式色左条 + 微字 */
  hudBg: "#0d141c",
  hudLine: "#1c2733",
  hudText: "#7d8fa3",
  /* 代码 / 正文 */
  codeBg: "#16212c",
  codeText: "#7fd6a8",
  codeKeyword: "#e8a13c",
  codeDim: "#3d5a4a",
  thinkBg: "#1a2130",
  thinkDot: "#8fb6e8",
  scan: "rgba(143,182,232,0.16)",
  /* 检索 */
  searchBg: "#1c2430",
  searchHit: "#e8c76a",
  /* 浏览器 */
  browserBg: "#1a2431",
  browserTab: "#26313f",
  browserTabOn: "#3d5470",
  browserBar: "#22303f",
  browserUrl: "#4a6b8c",
  browserText: "#5f7d95",
  browserImg: "#2f4a63",
  /* 文件（写 / 搜 / 看 / 改） */
  fileBg: "#1b262f",
  fileLine: "#3a5568",
  fileNew: "#6ed49a",
  fileDel: "#e0705f",
  fileHit: "#e8c76a",
  /* 终端 */
  termBg: "#101820",
  termText: "#7fd6a8",
  termPrompt: "#e8a13c",
  /* 调用服务 / 协作 */
  svcBg: "#18222e",
  svcPack: "#6fb3d8",
  svcBack: "#8fd6a8",
  /* 等待 */
  waitBg: "#20242c",
  waitRing: "#d8a04a",
  /* 产出成稿 */
  reportBg: "#172028",
  bar: "#6fb3d8",
  barAlt: "#8fd6a8",
  meter: "#3c5f7d",
  /* 完成 / 失败 */
  doneBg: "#152420",
  doneTick: "#6ed49a",
  failBg: "#241618",
  failCross: "#e0705f",
  /* 摸鱼：电视剧 / 游戏 */
  videoBg: "#0c1014",
  videoBar: "#07090c",
  videoFig: "#8fa3b8",
  videoSub: "#e8e2c0",
  gameBg: "#16202c",
  gameHero: "#e8a13c",
  gameBlock: "#6e8ba6",
  gameGround: "#2f4a63",
} as const;

/* ─────────────────────────────────────────────────────────────────────────
 * 3×5 像素微字模（2026-10-05 晚 新增）
 *
 * ⛔ 为什么不直接 `ctx.fillText`：屏面只有 ~50×34 逻辑像素，系统字体的最小字号
 *   在这个尺度上会糊成一团，而且**与像素风违和**（同一画面里画人物/家具的像素块
 *   旁边出现抗锯齿文字非常突兀）。
 * ⛔ 为什么不用 5×5：屏面内宽只有 ~46px，5×5 字模每个字要 6px ⇒ 只能放 7 个字；
 *   3×5 + 1px 字距 = 4px/字 ⇒ 11 字，够放 "SEARCH" 和计时数字。
 * ⛔ 只收**状态词/数字/命令字符**需要的字形（全部大写）；中文一律走滚动字幕前被滤掉
 *   （见 `tickerSafe`）—— 像素屏上画不了汉字，⛔ 不要为此换成系统字体。
 * ───────────────────────────────────────────────────────────────────────── */
const FONT: Record<string, number[]> = {
  "0": [0b111, 0b101, 0b101, 0b101, 0b111],
  "1": [0b010, 0b110, 0b010, 0b010, 0b111],
  "2": [0b111, 0b001, 0b111, 0b100, 0b111],
  "3": [0b111, 0b001, 0b111, 0b001, 0b111],
  "4": [0b101, 0b101, 0b111, 0b001, 0b001],
  "5": [0b111, 0b100, 0b111, 0b001, 0b111],
  "6": [0b111, 0b100, 0b111, 0b101, 0b111],
  "7": [0b111, 0b001, 0b001, 0b010, 0b010],
  "8": [0b111, 0b101, 0b111, 0b101, 0b111],
  "9": [0b111, 0b101, 0b111, 0b001, 0b111],
  A: [0b111, 0b101, 0b111, 0b101, 0b101],
  B: [0b110, 0b101, 0b110, 0b101, 0b110],
  C: [0b111, 0b100, 0b100, 0b100, 0b111],
  D: [0b110, 0b101, 0b101, 0b101, 0b110],
  E: [0b111, 0b100, 0b111, 0b100, 0b111],
  F: [0b111, 0b100, 0b111, 0b100, 0b100],
  G: [0b111, 0b100, 0b101, 0b101, 0b111],
  H: [0b101, 0b101, 0b111, 0b101, 0b101],
  I: [0b111, 0b010, 0b010, 0b010, 0b111],
  J: [0b001, 0b001, 0b001, 0b101, 0b111],
  K: [0b101, 0b101, 0b110, 0b101, 0b101],
  L: [0b100, 0b100, 0b100, 0b100, 0b111],
  M: [0b101, 0b111, 0b111, 0b101, 0b101],
  N: [0b101, 0b111, 0b111, 0b111, 0b101],
  O: [0b111, 0b101, 0b101, 0b101, 0b111],
  P: [0b111, 0b101, 0b111, 0b100, 0b100],
  Q: [0b111, 0b101, 0b101, 0b111, 0b001],
  R: [0b111, 0b101, 0b111, 0b110, 0b101],
  S: [0b111, 0b100, 0b111, 0b001, 0b111],
  T: [0b111, 0b010, 0b010, 0b010, 0b010],
  U: [0b101, 0b101, 0b101, 0b101, 0b111],
  V: [0b101, 0b101, 0b101, 0b101, 0b010],
  W: [0b101, 0b101, 0b111, 0b111, 0b101],
  X: [0b101, 0b101, 0b010, 0b101, 0b101],
  Y: [0b101, 0b101, 0b010, 0b010, 0b010],
  Z: [0b111, 0b001, 0b010, 0b100, 0b111],
  ":": [0b000, 0b010, 0b000, 0b010, 0b000],
  ".": [0b000, 0b000, 0b000, 0b000, 0b010],
  ",": [0b000, 0b000, 0b000, 0b010, 0b100],
  "-": [0b000, 0b000, 0b111, 0b000, 0b000],
  "_": [0b000, 0b000, 0b000, 0b000, 0b111],
  "+": [0b000, 0b010, 0b111, 0b010, 0b000],
  "=": [0b000, 0b111, 0b000, 0b111, 0b000],
  "/": [0b001, 0b001, 0b010, 0b100, 0b100],
  "\\": [0b100, 0b100, 0b010, 0b001, 0b001],
  "(": [0b001, 0b010, 0b010, 0b010, 0b001],
  ")": [0b100, 0b010, 0b010, 0b010, 0b100],
  "[": [0b011, 0b010, 0b010, 0b010, 0b011],
  "]": [0b110, 0b010, 0b010, 0b010, 0b110],
  "#": [0b101, 0b111, 0b101, 0b111, 0b101],
  "%": [0b101, 0b001, 0b010, 0b100, 0b101],
  "!": [0b010, 0b010, 0b010, 0b000, 0b010],
  ">": [0b100, 0b010, 0b001, 0b010, 0b100],
};

/** 微字模文本宽度（像素）。⛔ 与 `drawMicroText` 必须同一套度量，否则右对齐会飘。 */
export function microWidth(text: string, px = 1): number {
  if (!text) return 0;
  return text.length * 4 * px - px;
}

/** 画一段 3×5 微字模文本（未知字符留空格，⛔ 不抛错）。 */
export function drawMicroText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  px = 1,
): void {
  ctx.fillStyle = color;
  const up = String(text ?? "").toUpperCase();
  for (let i = 0; i < up.length; i += 1) {
    const glyph = FONT[up[i]];
    if (!glyph) continue;
    const gx = x + i * 4 * px;
    for (let r = 0; r < 5; r += 1) {
      const bits = glyph[r];
      for (let c = 0; c < 3; c += 1) {
        if (bits & (1 << (2 - c))) ctx.fillRect(gx + c * px, y + r * px, px, px);
      }
    }
  }
}

/**
 * 滚动字幕：把**真实事件细节**（命令 / 文件名 / 查询词）在屏面底部循环滚动。
 * ⛔ 为什么要滚而不是截断：微字模只有 11 个字的宽度，而真机命令动辄 40+ 字符，
 *   截断后用户只看到 `NPM RUN BU` 这种半截话，等于没信息。
 * ⛔ 汉字在像素屏上画不出来 ⇒ 调用方先做 `tickerSafe` 过滤（见 office-activity）。
 */
export function marqueeText(text: string, widthPx: number, t: number, px = 1): string {
  const clean = String(text ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const maxChars = Math.max(1, Math.floor((widthPx + px) / (4 * px)));
  if (clean.length <= maxChars) return clean;
  const padded = `${clean}    `;
  const offset = Math.floor(t * 3.2) % padded.length;
  return (padded.slice(offset) + padded.slice(0, offset)).slice(0, maxChars);
}

/** 画一个 5×5 点阵图（✓ / ✗ 这类"一眼可辨"的符号）。 */
function drawBitmap5(ctx: CanvasRenderingContext2D, rows: readonly string[], x: number, y: number, px: number, color: string): void {
  ctx.fillStyle = color;
  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < rows[r].length; c += 1) {
      if (rows[r][c] === "1") ctx.fillRect(x + c * px, y + r * px, px, px);
    }
  }
}
const GLYPH_TICK = ["00000", "00001", "10010", "10100", "01000"] as const;
const GLYPH_CROSS = ["10001", "01010", "00100", "01010", "10001"] as const;

/** 顶栏左侧的模式词（**与画面一一对应**，改画面记得改这里）。 */
function hudLabelOf(mode: ScreenMode): string {
  switch (mode) {
    case "code": return "WORK";
    case "thinking": return "THINK";
    case "search": return "SEARCH";
    case "wait": return "WAIT";
    case "report": return "OUT";
    case "done": return "DONE";
    case "failed": return "ERR";
    case "away": return "AWAY";
    case "idle": return "IDLE";
    case "browser": return "BROWSE";
    case "file-write": return "WRITE";
    case "file-search": return "FIND";
    case "file-read": return "OPEN";
    case "file-edit": return "EDIT";
    case "terminal": return "TERM";
    case "service": return "API";
    case "collab": return "SEND";
    case "video": return "TV";
    case "game": return "GAME";
    default: return "";
  }
}

/** 模式强调色（顶栏左条 + 标签）。⛔ 与语义绑定：完成=绿、失败=红，别改。 */
function accentOf(mode: ScreenMode): string {
  switch (mode) {
    case "done": return PAL.doneTick;
    case "failed": return PAL.failCross;
    case "code": return PAL.codeText;
    case "thinking": return PAL.thinkDot;
    case "search": return PAL.searchHit;
    case "wait": return PAL.waitRing;
    case "report": return PAL.barAlt;
    case "browser": return PAL.browserUrl;
    case "file-write": return PAL.fileNew;
    case "file-edit": return PAL.fileDel;
    case "file-search": return PAL.fileHit;
    case "file-read": return PAL.fileLine;
    case "terminal": return PAL.termPrompt;
    case "service": return PAL.svcPack;
    case "collab": return PAL.svcBack;
    case "video": return PAL.videoSub;
    case "game": return PAL.gameHero;
    case "away": return PAL.awayDot;
    default: return PAL.idleNum;
  }
}

function bgOf(mode: ScreenMode): string {
  switch (mode) {
    case "code": return PAL.codeBg;
    case "thinking": return PAL.thinkBg;
    case "search": return PAL.searchBg;
    case "wait": return PAL.waitBg;
    case "report": return PAL.reportBg;
    case "done": return PAL.doneBg;
    case "failed": return PAL.failBg;
    case "away": return PAL.awayBg;
    case "idle": return PAL.idleBg;
    case "browser": return PAL.browserBg;
    case "file-write": case "file-search": case "file-read": case "file-edit": return PAL.fileBg;
    case "terminal": return PAL.termBg;
    case "service": case "collab": return PAL.svcBg;
    case "video": return PAL.videoBg;
    case "game": return PAL.gameBg;
    default: return PAL.offBg;
  }
}

/** **由真实事件驱动**的模式（= 底部要显示"真实细节"滚动字幕、顶栏计时取事件耗时的那批）。 */
export const TOOL_SCREEN_MODES: ReadonlySet<ScreenMode> = new Set([
  "browser", "search", "file-write", "file-search", "file-read", "file-edit", "terminal", "service", "collab",
]);

/** 秒数（用于顶栏计时；<1s 不显示，避免刚开跑就闪一个 0）。 */
function secsText(elapsedMs?: number): string {
  if (!elapsedMs || elapsedMs < 1000) return "";
  const s = Math.floor(elapsedMs / 1000);
  return s < 100 ? `${s}S` : `${Math.floor(s / 60)}M`;
}

/** 产出字数（顶栏右侧；⛔ 显示的是**真实** output 长度）。 */
function charsText(chars: number): string {
  const n = Math.max(0, Math.floor(chars || 0));
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

/* ─────────────────────────────────────────────────────────────────────────
 * 映射
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * 完成/失败反馈的**时效裁剪**：`DONE_HOLD_MS` 之后回落成 `none`（⇒ 屏保）。
 *
 * ⛔ 为什么放在映射层而不是让宿主停止上报：宿主只在 React 重渲染时才会重算阶段，
 *   而"完成 60 秒后自动回到屏保"这件事**不能依赖重渲染**（用户可能一直开着办公室不动）。
 *   ⇒ 由绘制侧按绝对时刻判，宿主继续如实上报"最近一次是 done"即可。
 */
export function effectivePhase(phase: RunPhase, sinceMs: number, now: number): RunPhase {
  if (phase !== "done" && phase !== "failed") return phase;
  if (!sinceMs) return phase;
  return now - sinceMs > DONE_HOLD_MS ? "none" : phase;
}

/**
 * 屏保轮播：时钟 → 电视剧 → 游戏（用户 10-05：「摸鱼的时候播放电视剧或者游戏画面」）。
 * ⛔ 用 `seed` 错开相位 ⇒ 六个工位不会同时切档（同时切看起来像"整片屏一起闪"）；
 *   ⛔ 也**不能**用随机数 —— 那样每次重绘都在换画面（画布 60fps，随机 = 癫痫）。
 */
export function screensaverMode(tSec: number, seed: number): ScreenMode {
  const slots: ScreenMode[] = ["idle", "video", "game"];
  const phase = tSec / SCREENSAVER_SLOT_S + seed * 0.37;
  return slots[Math.abs(Math.floor(phase)) % slots.length];
}

/**
 * 事件种类 ⇒ 屏幕模式。
 * ⛔ **单一映射表**：`screenModeOf` 与名牌文案（`eventWordOf` / `eventWordZhOf`）
 *   全从它取 —— 写两份必然漂，用户会看到"名牌说改文件、屏幕上在跑命令"。
 * ⛔ 返回 null 表示"这种事件没有专属画面"（`thinking` 之外的产出类事件）——
 *   调用方据此交给**阶段判定**（writing→code / reporting→report），⛔ 别在这里另编一个。
 */
export function screenModeOfEvent(kind: OfficeActivityKind): ScreenMode | null {
  switch (kind) {
    case "browser": return "browser";
    case "websearch": return "search";
    case "file-write": return "file-write";
    case "file-search": return "file-search";
    case "file-read": return "file-read";
    case "file-edit": return "file-edit";
    case "terminal": return "terminal";
    case "service": return "service";
    case "collab": return "collab";
    case "thinking": return "thinking";
    default: return null;
  }
}

/** 事件词（**屏面顶栏**的英文短词；与 `hudLabelOf` 同源）。 */
export function eventWordOf(kind: OfficeActivityKind): string {
  const mode = screenModeOfEvent(kind);
  return mode ? hudLabelOf(mode) : "";
}

/** 事件词（**名牌**上的中文；名牌字号大，英文缩写在那儿很难读）。 */
export function eventWordZhOf(kind: OfficeActivityKind): string {
  switch (kind) {
    case "browser": return "开浏览器";
    case "websearch": return "查资料";
    case "file-write": return "写文件";
    case "file-search": return "搜文件";
    case "file-read": return "看文件";
    case "file-edit": return "改文件";
    case "terminal": return "跑命令";
    case "service": return "调服务";
    case "collab": return "分派";
    case "thinking": return "思考";
    /* 兜底给空串（⛔ 不要编一个"写正文"出来 —— 那种事件根本到不了这里） */
    default: return "";
  }
}

/**
 * 真实阶段 + 真实事件 + 离席活动 ⇒ 屏幕内容。
 * ⛔ 这是"显示器反映真实在干什么"的**唯一映射点**（改这里就够了，别在画布层再判一遍）。
 * ⛔ 优先级**刻意**是这样，别调换（每一条都有原因）：
 *   ① 空座 → off（最高，没人就没有一切）
 *   ② 离席 → away / search（人在外面，屏幕必须解释"他去哪了"）
 *   ③ 完成 / 失败 → done / failed（**终态优先于过程**：活干完了就该报结果，
 *      而不是继续演最后一条命令 —— 这正是用户要的"事件反馈"）
 *   ④ 真实事件 → 各工具画面（"此刻在干什么"比"这条命跑到哪个阶段"更具体）
 *   ⑤ 阶段 → wait / thinking / code / report
 *   ⑥ 屏保（时钟 / 剧 / 游戏）
 */
export function screenModeOf(input: {
  /** 离席活动（驱动人物走动 + 屏幕转 away/search） */
  activity: null | "tea" | "water" | "book" | "toilet" | "run" | "gym";
  mode: "work" | "idle";
  /** 宿主推导出的真实阶段（缺省 none ⇒ 屏保） */
  phase?: RunPhase;
  /** 该会话**最近一条真实事件**的种类（缺省 none ⇒ 看阶段） */
  event?: OfficeActivityKind | null;
  /** 有人 ⇒ 屏幕亮 */
  occupied: boolean;
}): ScreenMode {
  if (!input.occupied) return "off";
  /* 离席：去书架查资料 ⇒ 屏幕上就是"在检索"（比纯黑有信息量，也解释了人为什么不在）。
     ⛔ 原地喝茶（tea）不算离席 —— 人还在工位，屏幕该继续显示他在干的事。 */
  if (input.activity === "book") return "search";
  if (input.activity && input.activity !== "tea") return "away";
  const phase = input.phase ?? "none";
  if (phase === "failed") return "failed";
  if (phase === "done") return "done";
  /* 真实事件 → 专属画面（`message` 没有专属画面 ⇒ 交给下面的阶段判定） */
  if (input.event) {
    const byEvent = screenModeOfEvent(input.event);
    if (byEvent) return byEvent;
  }
  if (phase === "waiting") return "wait";
  if (phase === "thinking") return "thinking";
  if (phase === "reporting") return "report";
  if (phase === "writing") return "code";
  /* 没有运行信息但人在跑（running 由别处驱动、拿不到 run 记录）⇒ 敲代码屏 */
  if (input.mode === "work") return "code";
  return "idle";
}

/* ─────────────────────────────────────────────────────────────────────────
 * 绘制
 * ───────────────────────────────────────────────────────────────────────── */

/** 像素风"代码行"：每行若干段（缩进/关键字/正文），用方块画而不是字体（免字体在像素风里违和）。 */
const CODE_LINES = [
  [[0, 3], [1, 5], [2, 9]],
  [[1, 2], [3, 7], [5, 4]],
  [[0, 6], [2, 3], [7, 6]],
  [[2, 2], [4, 8], [6, 3]],
  [[0, 4], [1, 3], [5, 7]],
  [[1, 5], [3, 4], [9, 5]],
  [[0, 2], [2, 8], [6, 4]],
  [[3, 3], [5, 6], [8, 3]],
];

/** 文件面板的三种变体共用同一套"纸张 + 行"骨架（写 / 搜 / 看 / 改的差别只在行怎么动）。 */
function fileRows(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, rows: number, u: number, pad: number, color: string, seed: number) {
  for (let r = 0; r < rows; r += 1) {
    const len = w * (0.35 + ((r * 29 + seed * 7) % 55) / 100);
    ctx.fillStyle = color;
    ctx.fillRect(x + pad, y + r * (u + 1), Math.max(2, Math.round(len)), Math.max(1, u - 1));
  }
}

/**
 * 画一个屏幕。
 * @param t      全局帧时钟（秒）
 * @param mode   该成员当前事件/阶段决定的内容
 * @param seed   成员 id 派生 ⇒ 每人屏幕内容不同但不随机跳变
 * @param x/y/w/h 屏幕内容区（画布坐标）
 * @param info   真实信息（计时 / 产出字数 / 事件细节）
 */
export function drawScreen(
  ctx: CanvasRenderingContext2D,
  t: number,
  mode: ScreenMode,
  seed: number,
  x: number,
  y: number,
  w: number,
  h: number,
  info: ScreenInfo = {},
) {
  /* ⛔⛔ 所有尺寸**必须从 w/h 推导**，⛔ 不许硬编码。
     起因（2026-10-04）：屏面实测是 **50×34**（六个各不相同），而我第一版按"红框量出来的
     116×62" 写死排版（rowH=6、结果行 y+17+8r、柱子 6 根…）⇒ 内容撑出屏面，
     再叠加坐标也错位 ⇒ 用户看到"三个大黑块盖在桌子上"。
     ✅ 统一做法：先算一个**单位格** `u = max(2, round(h/10))`，其余全部按 u / w / h 推。 */
  const u = Math.max(2, Math.round(h / 10));   // 单位格：h=34 ⇒ u=3
  const pad = Math.max(1, Math.round(u * 0.5));
  const innerW = w - pad * 2;

  // 屏底（像素风：纯色，不要渐变）
  ctx.fillStyle = bgOf(mode);
  ctx.fillRect(x, y, w, h);

  // 熄屏：一点点反光暗示"没开"（⛔ 语义已收窄为**空座**）
  if (mode === "off") {
    ctx.fillStyle = PAL.offGlow;
    ctx.fillRect(x + pad, y + pad, innerW, u);
    return;
  }

  /* ── 顶栏（状态条）───────────────────────────────────────────────
     ⭐ 2026-10-05 晚：屏面上永远有一行**真实信息** ——
        左侧是模式词（WORK/BROWSE/WRITE/FIND/OPEN/EDIT/TERM/API/TV/DONE…），
        右侧是真实秒数或产出字数。
     ⛔ 为什么值得占掉 6px：屏面只有 50×34，"这人在干嘛"全靠这一行；
        只有图形没有文字时，用户（10-05 报"信息不完整"）看到的仍是一片抽象的色块。 */
  const hudH = Math.max(5, Math.min(9, Math.round(h * 0.18)));
  const hudTextY = y + Math.max(0, Math.floor((hudH - 5) / 2));
  ctx.fillStyle = PAL.hudBg;
  ctx.fillRect(x, y, w, hudH);
  ctx.fillStyle = accentOf(mode);
  ctx.fillRect(x, y, 2, hudH);
  const label = hudLabelOf(mode);
  if (label) drawMicroText(ctx, label, x + 4, hudTextY, accentOf(mode), 1);
  const right = mode === "report" && info.chars != null
    ? charsText(info.chars)
    : secsText(info.elapsedMs);
  if (right && microWidth(right, 1) + microWidth(label, 1) + 8 < w) {
    drawMicroText(ctx, right, x + w - microWidth(right, 1) - 2, hudTextY, PAL.hudText, 1);
  }
  ctx.fillStyle = PAL.hudLine;
  ctx.fillRect(x, y + hudH, w, 1);

  // 内容区（顶栏之下）
  const cy = y + hudH + 1;
  const ch = h - hudH - 1;
  /* ⭐ 底部滚动字幕（**真实事件细节**）：只在有 detail 的工具类模式出现，
     占 6px；不够高就不画（宁可少一行信息，也不要把内容挤成一条线）。 */
  const ticker = TOOL_SCREEN_MODES.has(mode) && info.detail && ch >= 20;
  const tickerH = ticker ? 6 : 0;
  const bodyH = ch - tickerH;
  const innerCH = bodyH - pad;
  if (ticker) {
    ctx.fillStyle = PAL.hudLine;
    ctx.fillRect(x, cy + bodyH, w, 1);
    const line = marqueeText(String(info.detail), innerW, t, 1);
    if (line) drawMicroText(ctx, line, x + pad, cy + bodyH + 1, PAL.hudText, 1);
  }

  /* ⛔ 离席（去接水 / 洗手间 / 跑步 / 举铁）——
     原来是"纯黑 + 久不久闪一下"，是**最常出现却最没信息**的一块。
     现在：压暗 + 三个呼吸点 + 一条慢扫光 ⇒ 一眼看出"这屏开着、人不在"。 */
  // away:【块标记】下面这一段是 away 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "away") {
    const sweepW = Math.max(4, Math.round(innerW * 0.32));
    const sx = x + pad + Math.round((Math.sin(t * 1.1 + seed * 0.7) * 0.5 + 0.5) * Math.max(0, innerW - sweepW));
    ctx.fillStyle = PAL.awaySweep;
    ctx.fillRect(sx, cy, sweepW, innerCH);
    for (let i = 0; i < 3; i += 1) {
      const phase = (t * 1.6 - i * 0.4) % 3;
      const on = phase >= 0 && phase < 1;
      ctx.fillStyle = on ? PAL.awayDot : PAL.hudBg;
      ctx.fillRect(x + pad + i * u * 2, cy + Math.round(innerCH / 2) - u, u, u);
    }
    return;
  }

  /* ⭐ 待机 = **时钟屏保**（真实本地时间：HH:MM + 秒条）。
     ⛔⛔ 用户报「显示器都还是固定的、没有动画」的两层原因之二：
       这里原先把"有人在座但没在跑"直接归到 "off" ⇒ 只画一个静态色块 ⇒
       委托真机 3.7s 就跑完，用户点开办公室时**全员待机** ⇒ 六块屏全黑静止。 */
  // idle:【块标记】下面这一段是 idle 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "idle") {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const px = innerCH >= 13 && innerW >= 34 ? 2 : 1;
    const label2 = `${hh}:${mm}`;
    const tw = microWidth(label2, px);
    const ly = cy + Math.max(0, Math.round((innerCH - 5 * px) / 2) - px);
    // 冒号按秒闪 ⇒ 即使分钟没变，屏面仍在动
    drawMicroText(ctx, d.getSeconds() % 2 === 0 ? label2 : label2.replace(":", " "), x + Math.max(pad, Math.round((w - tw) / 2)), ly, PAL.idleNum, px);
    // 秒条：60 秒走满一条 ⇒ 视线有明确落点
    const secW = Math.round(innerW * (d.getSeconds() / 60));
    ctx.fillStyle = PAL.idleBar;
    ctx.fillRect(x + pad, cy + innerCH - 2, innerW, 2);
    ctx.fillStyle = PAL.idleNum;
    ctx.fillRect(x + pad, cy + innerCH - 2, Math.max(1, secW), 2);
    return;
  }

  /* ⭐ 摸鱼 · 电视剧（屏保轮播第 2 档，用户点名「摸鱼时播放电视剧」）。
     画法：宽银幕黑边 + 画面里几个"人影"在动 + 底部字幕条按台词节拍跳 + 进度条推进。 */
  // video:【块标记】下面这一段是 video 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "video") {
    const bar = Math.max(2, Math.round(bodyH * 0.16));
    ctx.fillStyle = PAL.videoBar;
    ctx.fillRect(x, cy, w, bar);
    const screenTop = cy + bar;
    const screenH = Math.max(4, bodyH - bar * 2);
    ctx.fillStyle = PAL.videoBar;
    ctx.fillRect(x, cy + bar + screenH, w, bar);
    // 画面：两个"人影"（方块）在缓慢左右移动 —— 一眼看出是"有人在演"
    for (let i = 0; i < 2; i += 1) {
      const figW = Math.max(2, u);
      const spanX = Math.max(1, innerW - figW * 2);
      const fx = x + pad + Math.round((Math.sin(t * (0.5 + i * 0.23) + seed + i * 1.7) * 0.5 + 0.5) * spanX);
      const fy = screenTop + Math.round(screenH * 0.35) + i * u;
      ctx.fillStyle = PAL.videoFig;
      ctx.fillRect(fx, fy, figW, Math.max(3, u * 2));
      ctx.fillRect(fx - 1, fy - u, figW + 2, u - 1);   // 头
    }
    // 字幕条：按台词节拍闪烁（不是匀速闪 ⇒ 像有人在说话）
    const talk = (t * 2.4 + seed) % 1 < 0.72;
    if (talk) {
      const subW = Math.max(4, Math.round(innerW * (0.4 + ((Math.floor(t * 2.4) + seed) % 3) * 0.16)));
      ctx.fillStyle = PAL.videoSub;
      ctx.fillRect(x + Math.round((w - subW) / 2), screenTop + screenH - u - 1, subW, Math.max(1, u - 1));
    }
    // 进度条：这一集一直在推进（每 90 秒走满一条 ⇒ 看得出"看到哪了"）
    const prog = (t / 90 + seed * 0.13) % 1;
    ctx.fillStyle = PAL.idleBar;
    ctx.fillRect(x + pad, cy + bodyH - 2, innerW, 2);
    ctx.fillStyle = PAL.videoSub;
    ctx.fillRect(x + pad, cy + bodyH - 2, Math.max(1, Math.round(innerW * prog)), 2);
    return;
  }

  /* ⭐ 摸鱼 · 像素小游戏（屏保轮播第 3 档）。
     画法：地面线 + 一个**一直跳**的主角 + 迎面来的障碍块 + 右上角分数跳动 + 血条。 */
  // game:【块标记】下面这一段是 game 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "game") {
    const groundY = cy + bodyH - Math.max(3, u);
    ctx.fillStyle = PAL.gameGround;
    ctx.fillRect(x, groundY, w, Math.max(1, u - 1));
    // 主角：正弦跳跃（幅度够大才看得出在玩）
    const heroW = Math.max(2, u);
    const jump = Math.abs(Math.sin(t * 2.2 + seed));
    const heroX = x + pad + Math.round(innerW * 0.22);
    ctx.fillStyle = PAL.gameHero;
    ctx.fillRect(heroX, groundY - heroW - Math.round(jump * (innerCH * 0.55)), heroW, heroW);
    // 障碍：从右往左扫（速度与跳跃不同步 ⇒ 看起来像在躲）
    for (let i = 0; i < 2; i += 1) {
      const speed = 0.55 + i * 0.18;
      const ox = x + w - Math.round(((t * speed + seed * 0.31 + i * 0.5) % 1) * (w + innerW * 0.5));
      ctx.fillStyle = PAL.gameBlock;
      ctx.fillRect(ox, groundY - u * 2, Math.max(2, u - 1), Math.max(2, u * 2));
    }
    // 分数（真实在涨的数字）+ 血条
    const score = String(Math.floor(t * 7 + seed * 3) % 1000).padStart(3, "0");
    drawMicroText(ctx, score, x + w - microWidth(score, 1) - pad, cy, PAL.gameHero, 1);
    ctx.fillStyle = PAL.idleBar;
    ctx.fillRect(x + pad, cy, Math.max(3, Math.round(innerW * 0.34)), 1);
    ctx.fillStyle = PAL.fileDel;
    ctx.fillRect(x + pad, cy, Math.max(1, Math.round(innerW * 0.3)), 1);
    return;
  }

  // code：【块标记】下面这一段是 code 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "code") {
    /*⛔⛔ 2026-10-04 用户报「显示器上没有动画」—— 动画**在跑**，但屏面只有 50×34，
     *   原来的"逐行浮现"长满 6 行后就**完全静止**，只剩 3×3px 光标在闪 ⇒ 肉眼看不出。
     *   ✅ 改成**永远在动**的三件事（缺一件又变静态）：
     *     ① 内容**向上滚动**（不是长满就停）：行进位置随时间连续变化
     *     ② **活跃行**（正在敲的那行）随时间换行，且高亮 ⇒ 视线有落点
     *     ③ 活跃行里有一段"正在输入的尾巴"在伸长/收缩
     *   ⚠️ 屏面小 ⇒ 任何"渐变/缓慢淡入"都看不出来；必须是**位移或增删**。 */
    const rowH = u + 1;                       // h=34 ⇒ 4px/行
    const rows = Math.max(1, Math.floor(innerCH / rowH));
    // 每秒 1.15 行 ⇒ 一屏 5 行约 4.3s 走完，够慢到能看清在滚
    const head = Math.floor(t * 1.15);
    for (let r = 0; r < rows; r++) {
      const lineIndex = head + r;              // 每一行用不同内容 ⇒ 滚动看得出来
      const segs = CODE_LINES[(lineIndex + seed) % CODE_LINES.length];
      // ⛔ 纵向做**像素级滚动**（不是整行跳）：行高 4px、步长 1px ⇒ 连续移动
      const yOff = -((t * 1.15 * rowH) % rowH);
      const ly = Math.round(cy + r * rowH + yOff);
      if (ly + u <= cy || ly >= cy + bodyH) continue;   // 完全在屏外就不画
      segs.forEach(([indent, len], si) => {
        const lx = x + pad + indent * u;
        ctx.fillStyle = si === 0 ? PAL.codeKeyword : PAL.codeText;
        ctx.fillRect(lx, ly, Math.min(len * u, Math.max(1, x + w - pad - lx)), u - 1);
      });
    }
    // 活跃行：底部一行（永远可见）高亮 + 一段"正在输入"的尾巴在伸长/缩
    const activeY = cy + (rows - 1) * rowH;
    const tail = Math.round((Math.sin(t * 5) * 0.5 + 0.5) * innerW * 0.35);
    ctx.fillStyle = PAL.codeKeyword;
    ctx.fillRect(x + pad, activeY, Math.max(u, tail), u - 1);
    // 光标（跟随尾巴末端，1.6s 周期闪）
    ctx.fillStyle = "#e8f0f6";
    if ((t * 1.6) % 1 < 0.55) ctx.fillRect(x + pad + tail + u, activeY, u, u - 1);
    return;
  }

  // thinking：【块标记】下面这一段是 thinking 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "thinking") {
    /* ⛔ 原来只有"三个点上下跳 2px"+ 一条扫描线 ⇒ 50×34 屏面上几乎看不出动。
     * ✅ 改成两件**位移幅度够大**的事：
     *   ① 一条**横向扫描光标**在屏宽内来回扫（行程 = innerW ⇒ 肉眼明确）
     *   ② 三个思考点：跳动幅度给到 u（3px）且**整组上下浮沉**（不是只跳 2px） */
    // 横向扫描光标（来回，不是单向 ⇒ 不会"走完就没"）
    const sweep = Math.round((Math.sin(t * 1.6) * 0.5 + 0.5) * Math.max(0, innerW - u));
    ctx.fillStyle = PAL.scan;
    ctx.fillRect(x + pad + sweep, cy, u, bodyH);
    // 三个点：整组浮沉 + 逐个相位差
    const groupY = cy + innerCH / 2 - u / 2 + Math.round(Math.sin(t * 2.4) * (u * 0.9));
    for (let i = 0; i < 3; i++) {
      const phase = (t * 3 - i * 0.55) % 3;
      const lift = phase >= 0 && phase < 1 ? Math.round(u * Math.sin(phase * Math.PI)) : 0;
      ctx.fillStyle = PAL.thinkDot;
      ctx.fillRect(x + pad + innerW / 2 - u * 3 + i * u * 2, groupY - lift, u, u);
    }
    return;
  }

  // search：【块标记】下面这一段是 search 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "search") {
    /* 搜索引擎界面（**真实 `webSearch` 事件**，或离席去书架查资料）。
     * ⛔ 原来只有"命中高亮每 0.7s 换一行"，而**每行长度用 rnd() 固定**（同一 seed 每次一样）
     *   ⇒ 整屏只有一行变色 ⇒ 50×34 上看着几乎不动。
     * ✅ 三件持续变化的事：搜索光标来回扫 · 命中行**逐行下移** · 结果行**向上滚动**。 */
    const barH = u * 2;
    // 搜索框（宽度随时间轻微呼吸，像在加载）
    const boxW = Math.round(innerW * (0.66 + Math.sin(t * 1.9) * 0.06));
    ctx.fillStyle = PAL.thinkDot;
    ctx.fillRect(x + pad, cy, boxW, barH);
    // 放大镜
    ctx.fillStyle = PAL.searchBg;
    ctx.fillRect(x + pad + u, cy + Math.floor(u / 2), u, u);
    // 搜索光标：在框内**来回扫**（位移幅度 = 框宽，肉眼明确）
    const curX = x + pad + u * 2 + Math.round((Math.sin(t * 3.4) * 0.5 + 0.5) * Math.max(0, boxW - u * 4));
    ctx.fillStyle = "#e8f0f6";
    ctx.fillRect(curX, cy + Math.floor(u / 2), u, u);
    // 结果行：内容随"行号"变化（滚动感）+ 命中行逐行下移
    const resTop = cy + barH + u;
    const resRows = Math.max(1, Math.floor((cy + bodyH + pad - resTop) / (u * 2)));
    const hitRow = Math.floor(t * 1.6) % resRows;          // 命中行逐行往下走
    const scroll = Math.floor(t * 1.1);                    // 内容整体滚动
    for (let r = 0; r < resRows; r++) {
      const ry = resTop + r * u * 2;
      const hit = r === hitRow;
      ctx.fillStyle = hit ? PAL.searchHit : PAL.codeDim;
      // ⚠️ 长度由 (行号+seed) 决定 ⇒ 滚动时每行内容都在变；⛔ 不用 rnd()（同一 seed 恒定 ⇒ 静止）
      const n2 = (r + scroll + seed) % 3;
      const len = Math.round(innerW * (0.42 + n2 * 0.18));
      ctx.fillRect(x + pad, ry, len, u);
      // 未命中的行给一个"进度条"尾段，让画面层次更密
      if (!hit) {
        ctx.fillStyle = PAL.thinkDot;
        const dotW = Math.round(innerW * 0.14 * (0.4 + ((r + scroll) % 3) / 3));
        ctx.fillRect(x + pad + len + u, ry, dotW, u);
      }
    }
    return;
  }

  // file-write：【块标记】下面这一段是 file-write 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "file-write") {
    /* **写入 / 新建文件**（真实 fileChange 且全是新增行）。
       画面语言：纸张 + 一行行**从上往下长出来**的新行（绿色），右侧一个"已写入"高度条。 */
    const rows = Math.max(1, Math.floor(innerCH / (u + 1)));
    const grown = ((t * 1.8 + seed * 0.29) % (rows + 3));   // 每轮长满再重来 ⇒ 永远在长
    fileRows(ctx, x, cy, innerW, rows, u, pad, PAL.fileLine, seed);
    for (let r = 0; r < rows; r += 1) {
      if (r > grown) break;
      const len = innerW * (0.4 + ((r * 17 + seed * 5) % 50) / 100);
      ctx.fillStyle = PAL.fileNew;
      ctx.fillRect(x + pad, cy + r * (u + 1), Math.max(2, Math.round(len)), Math.max(1, u - 1));
    }
    // 写入光标：跟着最新一行走
    const caretY = cy + Math.min(rows - 1, Math.floor(grown)) * (u + 1);
    if ((t * 2.4) % 1 < 0.6) {
      ctx.fillStyle = "#e8f0f6";
      ctx.fillRect(x + w - pad - u, caretY, u, Math.max(1, u - 1));
    }
    return;
  }

  // file-read：【块标记】下面这一段是 file-read 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "file-read") {
    /* **查看文件**（真实命令意图 = 查看）。
       画面语言：文件行 + 一条高亮"视线"自上而下缓慢扫过（像人在读）+ 右侧滚动条滑块。 */
    const rows = Math.max(1, Math.floor(innerCH / (u + 1)));
    fileRows(ctx, x, cy, innerW - u, rows, u, pad, PAL.fileLine, seed);
    const readRow = Math.floor(((t * 0.9 + seed * 0.21) % 1) * rows);
    for (let r = 0; r < rows; r += 1) {
      if (r !== readRow) continue;
      const len = innerW * (0.5 + ((r * 17 + seed * 5) % 40) / 100);
      ctx.fillStyle = PAL.fileHit;
      ctx.fillRect(x + pad, cy + r * (u + 1), Math.max(2, Math.round(len)), Math.max(1, u - 1));
    }
    // 滚动条：滑块位置 = 视线位置（两者同源，⛔ 别各算一套）
    const trackX = x + w - pad - Math.max(1, Math.round(u * 0.5));
    const trackW = Math.max(1, Math.round(u * 0.5));
    ctx.fillStyle = PAL.hudLine;
    ctx.fillRect(trackX, cy, trackW, innerCH);
    ctx.fillStyle = PAL.fileHit;
    ctx.fillRect(trackX, cy + Math.round((readRow / Math.max(1, rows)) * Math.max(1, innerCH - u * 2)), trackW, u * 2);
    return;
  }

  // file-search：【块标记】下面这一段是 file-search 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "file-search") {
    /* **搜索文件内容**（真实命令意图 = 搜索）。
       画面语言：放大镜在文件行上**来回扫**（行程 = 屏宽）+ 被扫到的行变黄。 */
    const rows = Math.max(1, Math.floor(innerCH / (u + 1)));
    fileRows(ctx, x, cy, innerW, rows, u, pad, PAL.fileLine, seed);
    const scanX = x + pad + Math.round((Math.sin(t * 1.9 + seed * 0.3) * 0.5 + 0.5) * Math.max(0, innerW - u * 2));
    // 命中行：离扫描线最近的两行变黄（像"搜到了"）
    for (let r = 0; r < rows; r += 1) {
      const ry = cy + r * (u + 1);
      const hit = Math.abs(ry - (cy + bodyH * 0.5)) < u * 1.5 && Math.abs(scanX - (x + pad + innerW * 0.5)) < innerW * 0.5;
      if (!hit) continue;
      ctx.fillStyle = PAL.fileHit;
      ctx.fillRect(x + pad, ry, Math.max(2, Math.round(innerW * 0.8)), Math.max(1, u - 1));
    }
    // 放大镜
    ctx.fillStyle = PAL.fileHit;
    ctx.fillRect(scanX, cy + Math.round(bodyH * 0.5) - u, u, u);
    ctx.fillStyle = PAL.fileBg;
    ctx.fillRect(scanX + u, cy + Math.round(bodyH * 0.5) - u * 2, u, u);
    return;
  }

  // file-edit：【块标记】下面这一段是 file-edit 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "file-edit") {
    /* **修改文件**（真实 fileChange 带删除行）。
       画面语言：左红右绿的 diff 双栏 + 整体缓慢上滚（像在逐块过改动）。 */
    const rowH2 = u + 1;
    const rows = Math.max(1, Math.floor(innerCH / rowH2));
    const yOff2 = -((t * 0.6 * rowH2) % rowH2);
    const half = Math.max(3, Math.floor((innerW - u) / 2));
    // 中缝
    ctx.fillStyle = PAL.hudLine;
    ctx.fillRect(x + pad + half, cy, 1, innerCH);
    for (let r = 0; r < rows; r += 1) {
      const ly = Math.round(cy + r * rowH2 + yOff2);
      if (ly + u <= cy || ly >= cy + bodyH) continue;
      const idx = r + Math.floor(t * 0.6);
      const delLen = Math.max(2, Math.round(half * (0.35 + ((idx * 13 + seed) % 45) / 100)));
      const addLen = Math.max(2, Math.round(half * (0.35 + ((idx * 19 + seed * 3) % 55) / 100)));
      ctx.fillStyle = PAL.fileDel;
      ctx.fillRect(x + pad, ly, delLen, Math.max(1, u - 1));
      ctx.fillStyle = PAL.fileNew;
      ctx.fillRect(x + pad + half + 2, ly, addLen, Math.max(1, u - 1));
    }
    return;
  }

  // terminal：【块标记】下面这一段是 terminal 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "terminal") {
    /* **跑命令 / 构建 / 测试**（真实命令意图 = 运行）。
       画面语言：首行提示符（黄） + 输出行持续上滚 + 底部闪烁光标。 */
    const rowH2 = u + 1;
    const rows = Math.max(1, Math.floor(innerCH / rowH2));
    // 提示符行（固定在最上）
    ctx.fillStyle = PAL.termPrompt;
    ctx.fillRect(x + pad, cy, u * 2, Math.max(1, u - 1));
    const yOff2 = -((t * 1.4 * rowH2) % rowH2);
    for (let r = 0; r < rows; r += 1) {
      const ly = Math.round(cy + (r + 1) * rowH2 + yOff2);
      if (ly + u <= cy || ly >= cy + bodyH) continue;
      const idx = r + Math.floor(t * 1.4);
      const len = Math.round(innerW * (0.25 + ((idx * 23 + seed * 11) % 70) / 100));
      ctx.fillStyle = PAL.termText;
      ctx.fillRect(x + pad, ly, Math.max(2, len), Math.max(1, u - 1));
    }
    const caretY = cy + Math.min(rows, 1 + Math.floor(yOff2 + t * 1.4)) * rowH2;
    if ((t * 2.6) % 1 < 0.6) {
      ctx.fillStyle = "#e8f0f6";
      ctx.fillRect(x + pad, Math.max(cy, Math.min(cy + innerCH - u, caretY)), u, Math.max(1, u - 1));
    }
    return;
  }

  // service：【块标记】下面这一段是 service 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "service") {
    /* **调用外部服务**（真实 mcpToolCall / dynamicToolCall）。
       画面语言：请求包向右飞 → 响应包向左飞（一往一返，永远在动）+ 中间脉冲。 */
    const midY = cy + Math.round(innerCH / 2) - u;
    const travel = Math.abs((t * 0.7 + seed * 0.17) % 2 - 1);   // 0→1→0
    const fromX = x + pad;
    const toX = x + w - pad - u * 2;
    const reqX = Math.round(fromX + travel * (toX - fromX));
    ctx.fillStyle = PAL.svcPack;
    ctx.fillRect(reqX, midY - u - 1, u * 2, u - 1);
    const resX = Math.round(toX - travel * (toX - fromX));
    ctx.fillStyle = PAL.svcBack;
    ctx.fillRect(resX, midY + u + 1, u * 2, u - 1);
    // 脉冲：往返到端点时闪一下（像"请求发出去了/回来了"）
    if (travel > 0.96 || travel < 0.04) {
      ctx.fillStyle = PAL.svcBack;
      ctx.fillRect(x + Math.round(w / 2) - u, cy, u * 2, Math.max(1, u - 1));
    }
    return;
  }

  // collab：【块标记】下面这一段是 collab 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "collab") {
    /* **协作分派**（真实协作类事件）。
       画面语言：中心一个"我"，每隔一拍分裂出一个小方块飞向右上/右下（把活交出去）。 */
    const cx = x + pad + u;
    const cyv = cy + Math.round(innerCH / 2) - Math.round(u / 2);
    ctx.fillStyle = PAL.svcBack;
    ctx.fillRect(cx, cyv, u * 2, u * 2);
    for (let i = 0; i < 2; i += 1) {
      const p = ((t * 0.85 + i * 0.5 + seed * 0.13) % 1);
      const px = Math.round(cx + u * 2 + p * Math.max(0, innerW - u * 5));
      const py = Math.round(cyv + (i === 0 ? -1 : 1) * p * (innerCH / 3));
      ctx.fillStyle = PAL.svcPack;
      ctx.fillRect(px, py, Math.max(2, u - 1), Math.max(2, u - 1));
    }
    return;
  }

  // wait：【块标记】下面这一段是 wait 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "wait") {
    /* 长时间无产出（真实触发：status=running 且 8 秒还没吐一个字）。
       ⛔ 不能只画转圈 —— 那和"思考中"分不开；加一圈**扩散呼吸环**表示"已经等很久了"。 */
    const cx = x + w / 2;
    const cyc = cy + bodyH / 2;
    const r = Math.max(u, Math.min(innerW, innerCH) / 2 - u);
    for (let i = 0; i < 8; i++) {
      const a = (t * 3 + i * 0.785) % (Math.PI * 2);
      ctx.fillStyle = i === 0 ? PAL.waitRing : PAL.codeDim;
      ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cyc + Math.sin(a) * r), u, u);
    }
    const pulse = (t * 0.8) % 1;
    ctx.globalAlpha = Math.max(0, 0.5 - pulse * 0.5);
    ctx.fillStyle = PAL.waitRing;
    ctx.fillRect(Math.round(cx - r - pulse * u * 2), Math.round(cyc - r - pulse * u * 2), Math.round(u * 2 + pulse * u * 4), Math.round(u * 2 + pulse * u * 4));
    ctx.globalAlpha = 1;
    return;
  }

  // done：【块标记】下面这一段是 done 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "done") {
    /* ⭐ 完成反馈。
       ⛔ 病根：原来委托跑完 = 从 `runningByMember` 消失 ⇒ `eventStateOf` 返 null
         ⇒ 屏幕直接跳回待机屏保 ⇒ **用户看不到任何"干完了"的反馈**
         （这正是"操作后没有任何响应"的观感来源之一）。
       ✅ 现在：✓ 对勾 + 真实用时（顶栏右侧），并在整屏上扫一道"完成光"。 */
    const px = Math.max(1, Math.min(3, Math.floor(Math.min(innerW - 8, innerCH - 6) / 5)));
    const tw = px * 5;
    drawBitmap5(ctx, GLYPH_TICK, Math.round(x + (w - tw) / 2), cy + Math.max(0, Math.round((innerCH - tw) / 2)), px, PAL.doneTick);
    const glowT = (t * 0.9 + seed * 0.2) % 2;
    const glowX = x + Math.round((glowT < 1 ? glowT : 2 - glowT) * w);
    ctx.fillStyle = "rgba(110,212,154,0.16)";
    ctx.fillRect(glowX - u * 2, y, u * 4, h);
    return;
  }

  // failed：【块标记】下面这一段是 failed 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "failed") {
    /* ⭐ 失败反馈：✗ + 真实用时。
       ⛔ 原来失败与成功**在办公室里的表现完全一样**（都只是"人站着"），
         用户根本分不出哪个成员挂了 —— 而 `TeamMemberRunRecord.error` 一直是有的。 */
    const px = Math.max(1, Math.min(3, Math.floor(Math.min(innerW - 8, innerCH - 6) / 5)));
    const tw = px * 5;
    drawBitmap5(ctx, GLYPH_CROSS, Math.round(x + (w - tw) / 2), cy + Math.max(0, Math.round((innerCH - tw) / 2)), px, PAL.failCross);
    // 报警闪烁：整屏红光呼吸（⛔ 用透明度变化而不是颜色渐变 —— 屏面小，颜色渐变看不出来）
    if ((t * 2.2 + seed) % 1 < 0.12) {
      ctx.fillStyle = "rgba(224,112,95,0.14)";
      ctx.fillRect(x, y, w, h);
    }
    return;
  }

  // browser：【块标记】下面这一段是 browser 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "browser") {
    /* ⭐ **打开浏览器**（真实事件：命令里启动浏览器 / 浏览器类 MCP 工具）。
       画面语言：标签条 + 地址栏 + 页面（标题/正文/图片位）+ 一个**来回移动并点击**的鼠标指针
       —— ⛔ 必须比"检索页"更像"浏览器窗口"，否则用户分不出"打开了浏览器"和"搜了个东西"。 */
    const tabH = Math.max(3, u + 1);
    for (let i = 0; i < 3; i += 1) {
      ctx.fillStyle = i === 0 ? PAL.browserTabOn : PAL.browserTab;
      ctx.fillRect(x + pad + i * (u * 3 + 1), cy, u * 3, Math.max(2, tabH - 1));
    }
    const addrY = cy + tabH;
    ctx.fillStyle = PAL.browserBar;
    ctx.fillRect(x + pad, addrY, innerW, Math.max(2, u));
    // 地址栏里的 URL：随时间左右扫（像在加载）
    const urlW = Math.max(3, Math.round(innerW * 0.62));
    const urlX = x + pad + u + Math.round((Math.sin(t * 1.3) * 0.5 + 0.5) * Math.max(0, innerW - urlW - u * 2));
    ctx.fillStyle = PAL.browserUrl;
    ctx.fillRect(urlX, addrY + 1, urlW, Math.max(1, u - 2));
    // 页面：标题 + 两行正文 + 一个图片占位
    const pageY = addrY + Math.max(2, u) + 1;
    const pageH = Math.max(3, cy + bodyH - pageY);
    ctx.fillStyle = PAL.browserText;
    ctx.fillRect(x + pad, pageY, Math.max(3, Math.round(innerW * 0.55)), Math.max(1, u - 1));
    ctx.fillStyle = PAL.browserImg;
    const imgW = Math.max(3, Math.round(innerW * 0.3));
    ctx.fillRect(x + w - pad - imgW, pageY, imgW, Math.max(3, Math.round(pageH * 0.7)));
    for (let r = 0; r < 2; r += 1) {
      const len = Math.max(3, Math.round(innerW * (0.42 - r * 0.12)));
      ctx.fillStyle = PAL.browserText;
      ctx.fillRect(x + pad, pageY + (r + 1) * (u + 1), len, Math.max(1, u - 1));
    }
    // 鼠标指针：在页面上小幅来回；到端点时"点击"（闪一个方块）
    const mx = x + pad + Math.round((Math.sin(t * 1.7 + seed * 0.4) * 0.5 + 0.5) * Math.max(0, innerW - u * 2));
    const my = pageY + Math.round(pageH * 0.5) + Math.round(Math.sin(t * 2.4) * u);
    const clickOn = (t * 1.7 + seed * 0.4) % 3.1 < 0.12;
    if (clickOn) {
      ctx.fillStyle = "rgba(232,199,106,0.55)";
      ctx.fillRect(mx - u, my - u, u * 3, u * 2);
    }
    ctx.fillStyle = "#eef2f6";
    ctx.fillRect(mx, my, u, Math.max(1, u - 1));
    ctx.fillRect(mx + u, my + u, Math.max(1, u - 1), u);
    return;
  }

  // report：【块标记】下面这一段是 report 模式的绘制代码（判据面依赖这个标记定位）
  /* ⭐ 产出已成稿（真实触发：output ≥ REPORT_CHARS）。
     ⛔ 与 code 的区别：code 是"还在敲"，report 是"已经在成文/汇报"。 */
  const n = Math.max(3, Math.floor(innerW / (u * 2)));   // ⛔ 不写死 6 根
  const slot = Math.floor(innerW / n);
  const bw = Math.max(1, slot - u);
  // 真实产出量条（底部 2px）：随 output 字数增长 ⇒ 看得见"写了多少"
  const meterY = cy + bodyH - 2;
  const meterW = Math.round(innerW * Math.min(1, Math.max(0, (info.chars ?? 0)) / (REPORT_CHARS * 4)));
  const barArea = Math.max(4, bodyH - pad - 2 - u);
  for (let i = 0; i < n; i++) {
    // ⛔ 原来 grow 到 1 就静止 ⇒ 只有前 6 秒在动。改成**长完之后继续小幅波动**：
    //   每根柱子在基准高度上按自己的相位上下浮动（±18%），永远不静止。
    //   ⚠️ 用 i+seed 错开相位 ⇒ 不会整齐上下，看起来像数据在动。
    const base = 0.25 + ((i * 37 + seed * 13) % 70) / 100;   // 稳定的基准高度（不用 rnd()，否则每帧抖）
    const wobble = 1 + Math.sin(t * 2.1 + i * 0.9 + seed) * 0.18;
    const grow = Math.min(1, Math.max(0, t * 0.9 - i * 0.28));
    const bh = Math.max(1, Math.round(barArea * base * wobble * grow));
    ctx.fillStyle = i % 2 ? PAL.bar : PAL.barAlt;
    ctx.fillRect(x + pad + i * slot, cy + barArea - bh, bw, bh);
    // 柱顶亮点：跟着柱高走 ⇒ 波动更明显
    ctx.fillStyle = PAL.barAlt;
    ctx.fillRect(x + pad + i * slot, cy + barArea - bh, bw, u - 1);
  }
  ctx.fillStyle = PAL.meter;
  ctx.fillRect(x + pad, meterY, innerW, 2);
  ctx.fillStyle = PAL.barAlt;
  ctx.fillRect(x + pad, meterY, Math.max(1, meterW), 2);
}
