/**
 * main 的「git-bin」部分（09-22 从同目录 main.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { Menu, Notification, app, BrowserWindow, clipboard, globalShortcut, ipcMain, nativeTheme, net, powerSaveBlocker, protocol, safeStorage, session, shell, systemPreferences } from "electron";
import { execSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, watch as watchFs, writeFileSync, type Dirent } from "node:fs";
import path from "node:path";
import { augmentedPath, bundledGit, bundledNode, bundledPython, CHINA_NPM_REGISTRY, cloakCacheDir, cloakOpenHelper, downloadEnv, nuphusBinary, npmGlobalRoot, toolchainEnv, toolsRoot } from "../toolchain";
import { appSourceRoot } from "../runtime-refs";
/** git 可执行文件路径缓存（09-24 从 main.ts 迁入本模块：全仓仅此处使用）。 */
let gitBinCache = "";
export function gitBin(): string {
  if (gitBinCache) return gitBinCache;
  // 系统 PATH 里通常没有 git（GUI 进程继承的注册表 PATH 无 Git Bash 注入）——
  // 按候选顺序解析：应用自带便携版 → 常见安装位置 → 最后才赌 PATH
  // ⛔ mac 适配（09-17 审计）：darwin 没有便携 git，用系统那份；且 GUI 进程的 PATH 是 launchd
  //    给的最小集，/usr/bin/git 是 Xcode 命令行工具提供的 shim，homebrew 在 /opt/homebrew/bin。
  const candidates = process.platform === "darwin"
    ? [
        "/usr/bin/git",
        "/opt/homebrew/bin/git",
        "/usr/local/bin/git",
        path.join(toolsRoot(), "git", "bin", "git"),
      ]
    : [
        path.join(appSourceRoot(), "resources", "tools", "git", "cmd", "git.exe"),
        path.join(process.resourcesPath || app.getAppPath(), "tools", "git", "cmd", "git.exe"),
        "C:\\Program Files\\Git\\cmd\\git.exe",
        path.join(process.env.LOCALAPPDATA || "", "Programs", "Git", "cmd", "git.exe"),
      ];
  gitBinCache = candidates.find((c) => c && existsSync(c)) ?? "git";
  return gitBinCache;
}

export function gitExec(root: string, args: string): string {
  const bin = `"${gitBin()}"`;
  try {
    // -c core.quotepath=off：中文/特殊字符文件名默认输出带引号的八进制转义（"docs\350\207\252..."），
    // ls-files 之类按行解析路径的调用会拿到坏路径（实测炸过）
    return execSync(`${bin} -c core.quotepath=off ${args}`, { cwd: root, timeout: 90_000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  } catch (error: any) {
    // 把 stderr 带进错误信息：否则切换失败只显示「Command failed」，查不到原因
    const detail = String(error?.stderr ?? "").trim() || String(error?.message ?? error);
    throw new Error(`git ${args.split(" ")[0]} 失败：${detail.slice(0, 200)}`);
  }
}
