/**
 * openfilm 的路径与设置（10-27 批次二从 features/openfilm-ipc.ts 抽出）。
 *
 * 为什么单独一文件：Studio 打开（`studio.ts`）与模型工具（`tools.ts`）都要算同一个安装根、
 * 读同一份设置。放在 IPC 域文件里会形成 **ipc → studio → ipc** 的循环 import
 * （本项目踩过：CJS 循环下 `plugin === undefined`，启动即崩且报错指向容器）。
 * ⇒ 纯路径/设置放这里，三方都向下依赖它。
 *
 * ⛔ 惰性求值：本模块**不得**在顶层调 `app.getPath()` / `writeToolsRoot()`
 *    （模块体早于 main.ts 的 `app.setPath("userData")`，会拿到默认目录 —— 记忆里的 91 号坑）。
 */
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeToolsRoot } from "../toolchain";

/** npm 包名（bin = openfilm）。 */
export const PKG = "openfilm";

export type Settings = {
  /** 自动更新三档（与主应用同款语义） */
  autoUpdate: "off" | "startup" | "auto";
  /** 镜像策略：auto = 优先国内镜像，official = 只用官方 */
  mirror: "auto" | "official";
  /** 上次查版本的时刻（毫秒；启动检查按 24h 节奏，⛔ 别每次启动都打网络） */
  lastCheckedAt?: number;
};

export const DEFAULT_SETTINGS: Settings = { autoUpdate: "startup", mirror: "auto" };

/** 安装根（随工具目录走；覆盖安装/重装后不用重下 100MB 浏览器）。 */
export function openfilmRoot(): string {
  return path.join(writeToolsRoot() || app.getPath("userData"), "openfilm");
}

export function runtimeDir(): string {
  return path.join(openfilmRoot(), "runtime");
}

export function pkgDir(): string {
  return path.join(runtimeDir(), "node_modules", PKG);
}

/** CLI 入口（用 node 直接跑 .mjs；⛔ 不依赖 .bin 里的符号链接/cmd 包装）。 */
export function cliEntry(): string {
  return path.join(pkgDir(), "bin", "openfilm.mjs");
}

/** 装好没有（读 package.json 的 version，比跑一次 CLI 便宜得多）。 */
export function cliVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir(), "package.json"), "utf8"));
    return String(pkg?.version ?? "");
  } catch { return ""; }
}

/* ⛔ 必须写成 function 声明（不是箭头 const）：预检【91】扫的是「模块顶层表达式里出现 app.getPath」，
   箭头函数在它眼里仍算顶层求值。 */
export function settingsFile(): string {
  return path.join(app.getPath("userData"), "openfilm", "settings.json");
}

export function readSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    return {
      autoUpdate: ["off", "startup", "auto"].includes(raw?.autoUpdate) ? raw.autoUpdate : DEFAULT_SETTINGS.autoUpdate,
      mirror: raw?.mirror === "official" ? "official" : "auto",
      ...(Number.isFinite(raw?.lastCheckedAt) ? { lastCheckedAt: Number(raw.lastCheckedAt) } : {}),
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function writeSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...readSettings(), ...patch };
  if (!["off", "startup", "auto"].includes(next.autoUpdate)) next.autoUpdate = DEFAULT_SETTINGS.autoUpdate;
  if (!["auto", "official"].includes(next.mirror)) next.mirror = "auto";
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), "utf8");
  } catch { /* 落盘失败不影响主流程（下次读回默认值） */ }
  return next;
}

/** Studio 的机器级 home（上游 `studioHome()`：`OPENFILM_HOME` 覆盖，否则 `~/.openfilm`）。 */
export function studioHome(): string {
  return process.env.OPENFILM_HOME || path.join(os.homedir(), ".openfilm");
}

/**
 * 新片的默认落点：`<workspace>/films`（设计稿 §3.1 定案）。
 * ⛔ 不放 userData：那个路径含空格与中文（`Codex Harness Desktop`），而影片目录会被 `open` 记住、
 *    被 Studio 库索引、被 git 版本化 —— 放在用户项目里既可见也可备份。
 */
export function filmsRootFor(workspace: string): string {
  const base = String(workspace ?? "").trim();
  return base ? path.join(base, "films") : "";
}
