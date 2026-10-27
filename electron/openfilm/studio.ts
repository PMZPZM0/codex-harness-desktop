/**
 * OpenFilm Studio 的**连接层**（10-27 批次二）。
 *
 * ── "配对"是什么（先把话说清楚，这条最容易误解）──────────────────────────────
 * 上游**没有账号、没有云端、没有配对码**。所谓配对 = 让 Codex 与用户看的
 * **同一个 Studio 实例**指向**同一个影片目录**。所以本文件的全部工作是：
 *   ① 跑一次 `openfilm open <dir>`（幂等：已有页面只切项目、不新开）；
 *   ② 从 stdout 抓 `Studio <url>`（⛔ 只认这一行，URL 结构随版本变）；
 *   ③ 把这个 URL 开进**内置浏览器**（同一个 Chromium 引擎 ⇒ 预览即导出）；
 *   ④ 记住"现在连的是谁"（`<userData>/openfilm/session.json`），供状态查询与卡片显示。
 *
 * ── 进程守护的真相 ─────────────────────────────────────────────────────────
 * ⛔ **不要跟踪我们自己 spawn 的 pid**：`open` 把请求 POST 给 Studio 就退出了，
 *    Studio 是**另一个 detached 进程**（`studio/client.mjs` 的 `ensureStudio()` `detached: true` + `unref()`）。
 *    真 pid 在机器级的 `~/.openfilm/run.json` 里（内含 pid / supervisor / origin / key / version / app）。
 * ⇒ 存活判据 = `run.json` + `GET {origin}/api/health`（返回 product=openfilm-studio 才算活）。
 * ⛔ **不提供"关闭 Studio"的通道**：这个实例可能正被上游桌面 App 或另一个 agent 用着，
 *    杀它 = 丢用户没保存的手改（设计稿 §3.3 第 6 条：退出应用不强杀）。
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { broadcastCodexEvent } from "../features/window-bus";
import { cliEntry, cliVersion, studioHome } from "./paths";
import { runCli } from "./runner";

export type StudioState = {
  /** 服务在答（health 通过） */
  alive: boolean;
  /** 能在内置浏览器打开的地址（项目页；拿不到项目时退化成服务根） */
  url: string;
  /** 服务根 http://127.0.0.1:<port> */
  origin: string;
  /** 当前项目目录（空 = Studio 在，但没打开任何影片） */
  projectPath: string;
  pid: number;
  version: string;
  /** 是上游桌面 App 起的 Studio（它随 App 更新，不是我们这套 CLI） */
  app: boolean;
  startedAt: number;
  checkedAt: number;
};

export type StudioSession = Pick<StudioState, "url" | "origin" | "projectPath" | "pid" | "version" | "app" | "startedAt">;

function sessionFile(): string {
  return path.join(app.getPath("userData"), "openfilm", "session.json");
}

export function readSession(): StudioSession | null {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionFile(), "utf8"));
    return {
      url: String(raw?.url ?? ""),
      origin: String(raw?.origin ?? ""),
      projectPath: String(raw?.projectPath ?? ""),
      pid: Number(raw?.pid ?? 0) || 0,
      version: String(raw?.version ?? ""),
      app: Boolean(raw?.app),
      startedAt: Number(raw?.startedAt ?? 0) || 0,
    };
  } catch { return null; }
}

function writeSession(session: StudioSession): void {
  try {
    fs.mkdirSync(path.dirname(sessionFile()), { recursive: true });
    fs.writeFileSync(sessionFile(), JSON.stringify(session, null, 2), "utf8");
  } catch { /* 落盘失败不影响连接（下次靠 run.json 重新探活） */ }
}

/** 机器级运行信息（上游 `~/.openfilm/run.json`；桌面 App 与 CLI 共享同一个文件）。 */
function readRunJson(): { pid?: number; supervisor?: number; origin: string; version?: string; app?: boolean } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(studioHome(), "run.json"), "utf8"));
    const origin = String(raw?.origin ?? "");
    if (!/^https?:\/\/\S+$/.test(origin)) return null;
    return { origin, pid: Number(raw?.pid ?? 0) || undefined, version: raw?.version, app: Boolean(raw?.app) };
  } catch { return null; }
}

/** health 探活（1.5s 超时；⛔ 判据是 product 字段，不是 HTTP 200 —— 端口上可能蹲着别的服务）。 */
async function health(origin: string): Promise<{ version: string; app: boolean } | null> {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body: any = await response.json();
    if (body?.product !== "openfilm-studio") return null;
    return { version: String(body?.version ?? ""), app: Boolean(body?.app) };
  } catch { return null; }
}

/** 现状快照（不启动任何进程、不写盘）。 */
export async function probeStudio(): Promise<StudioState> {
  const checkedAt = Date.now();
  const empty: StudioState = { alive: false, url: "", origin: "", projectPath: "", pid: 0, version: "", app: false, startedAt: 0, checkedAt };
  const run = readRunJson();
  if (!run) {
    /* run.json 丢了但 Studio 还在跑（上游也会按默认端口兜底）—— 这里不猜端口：没有 run.json 就当没连上，
       下一次 `open` 会重新问它要地址（幂等，不会新开一个实例）。 */
    return empty;
  }
  const said = await health(run.origin);
  if (!said) return empty;
  const session = readSession();
  const sameInstance = Boolean(session?.origin) && session?.origin === run.origin;
  return {
    alive: true,
    /* 项目页地址只能从 `open` 的 stdout 拿到（Studio 不提供"当前页地址"接口）⇒ 用上次记下的；
       ⛔ 换了实例（origin 变了）就不能复用旧 url（那个 key 属于上个进程）。 */
    url: sameInstance && session ? session.url : run.origin,
    origin: run.origin,
    projectPath: sameInstance && session ? session.projectPath : "",
    pid: run.pid ?? 0,
    version: said.version || String(run.version ?? ""),
    app: said.app || Boolean(run.app),
    startedAt: sameInstance && session ? session.startedAt : checkedAt,
    checkedAt,
  };
}

export type OpenStudioResult = {
  ok: boolean;
  code?: string;
  error?: string;
  url: string;
  origin: string;
  projectPath: string;
  pid: number;
  version: string;
  /** 上游那一行的提示（例如"已在浏览器打开，这次只切项目"），转述给模型/用户 */
  note: string;
  studio: StudioState;
};

/**
 * 打开（或切到）某部影片的 Studio 页面。
 * @param filmDir 影片目录（绝对路径；不存在则由 Studio 建一个空片：`film.html` + `.film/`）
 * @param cwd     跑 CLI 的位置（相对路径按它解析；缺省 = filmDir 的父目录）
 */
export async function openStudio(input: { filmDir?: string; cwd?: string } = {}): Promise<OpenStudioResult> {
  const filmDir = String(input.filmDir ?? "").trim();
  const version = cliVersion();
  if (!version) {
    return { ok: false, code: "OF_E_NOT_READY", error: "OpenFilm 还没安装：请让用户在「设置 → 开发工具 → OpenFilm 视频剪辑」点一次「下载并安装」", url: "", origin: "", projectPath: "", pid: 0, version: "", note: "", studio: await probeStudio() };
  }
  const cwd = String(input.cwd ?? "").trim() || (filmDir ? path.dirname(filmDir) : studioHome());
  const args = filmDir ? ["open", filmDir] : ["open"];
  const result = await runCli(cliEntry(), args, {
    verb: "open",
    cwd,
    /* 首次 `open` 可能顺手装 Chromium（≈100MB）—— 我们已经单独装过，这里只是兜底，给足时间 */
    timeoutMs: 180_000,
  });
  const stdout = result.stdout;
  const url = (/^Studio\s+(https?:\/\/\S+)/m.exec(stdout)?.[1] ?? "").trim();
  const projectPath = (() => {
    const line = /^project\s+(.+)$/m.exec(stdout)?.[1]?.trim() ?? "";
    /* 没项目时上游写的是 `project  none yet: …` 一句人话，不是路径 */
    return line && !/^none yet/i.test(line) ? line : "";
  })();
  const note = (/^\s{2,}(open this address.*|already open.*|opened in your browser.*)$/m.exec(stdout)?.[1] ?? "").trim();

  if (!url) {
    const detail = (result.stderr || result.stdout || "").trim().split("\n").slice(-4).join("\n");
    const code = result.timedOut ? "OF_E_TIMEOUT" : result.code === 2 ? "OF_E_NOT_PROJECT" : "OF_E_STUDIO";
    return {
      ok: false, code,
      error: `Studio 没起来${result.timedOut ? "（超时）" : `（退出码 ${result.code}）`}：${detail || "没有输出"}`,
      url: "", origin: "", projectPath, pid: 0, version, note, studio: await probeStudio(),
    };
  }

  const origin = (() => { try { return new URL(url).origin; } catch { return ""; } })();
  const said = origin ? await health(origin) : null;
  const session: StudioSession = {
    url, origin, projectPath,
    pid: readRunJson()?.pid ?? 0,
    version: said?.version || version,
    app: Boolean(said?.app || readRunJson()?.app),
    startedAt: Date.now(),
  };
  if (said) writeSession(session);
  const studio = await probeStudio();
  /* 渲染层据此把 URL 开进内置浏览器（⛔ 主进程不去开 —— 内置浏览器是渲染层的 webview） */
  broadcastCodexEvent({ type: "openfilm", phase: "studio", url, projectPath, origin, alive: Boolean(said) });
  return { ok: true, url, origin, projectPath, pid: session.pid, version: session.version, note, studio };
}
