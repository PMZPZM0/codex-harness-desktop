/**
 * phone-harness 手机控制（09-27 新增）
 *
 * 让引擎能摸到真机：Android 走 adb（Windows / Linux / macOS 都行），iPhone 走 Mac 的
 * 「iPhone 镜像」窗口（**仅 macOS**）。上游是 Python CLI（`pip install phone-harness`，
 * MIT），不是 MCP 服务 —— 所以这里是「工具 + 技能」而不是连接器模板：装好后把它的
 * SKILL.md 注册成引擎技能，模型自己按 skill 里的写法 `phone-harness <<'PY' …` 调用。
 *
 * ⛔ 平台分叉是硬边界，不是文案差异：
 *   · win32 / linux —— 只有 Android 通道（adb）与云手机；iPhone 通道不可用（需要 macOS）。
 *   · darwin        —— Android 通道 + iPhone 镜像（还要求辅助功能 / 屏幕录制授权）。
 *   UI 必须按这两个分支显示不同的能力清单与权限引导（见渲染层 PhoneHarnessSection）。
 *
 * ⛔ 上游遥测默认开启，且会上报 task 文本与每步调用参数（上游 issue #100 正在修）。
 *    装机后**立刻** `config set telemetry false`：这是本机数据边界，不跟随上游默认值。
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { app } from "electron";
import { bundledPython } from "../toolchain";
import { codexHome } from "../runtime-paths";

/** 清华 PyPI 镜像（与 markitdown / install-runtimes 同一套口径：国内先走镜像）。 */
const PIP_INDEX = process.env.PHONE_HARNESS_PIP_INDEX ?? "https://pypi.tuna.tsinghua.edu.cn/simple";
const SKILL_DIR_NAME = "phone-harness";

export interface PhoneHarnessStatus {
  /** 实际平台：决定 iPhone 通道在不在（darwin 才有）。 */
  platform: NodeJS.Platform;
  /** 用来安装/运行的 Python（自带优先，其次系统）。 */
  python: string;
  /** Python 是否可用（决定能不能装）。 */
  pythonOk: boolean;
  /** pip 包 phone-harness 是否已安装。 */
  installed: boolean;
  version: string;
  /** adb 是否可用（Android 通道）。 */
  adb: boolean;
  /** 技能是否已注册到 $CODEX_HOME/skills/phone-harness/SKILL.md。 */
  skill: boolean;
  /** 上游遥测是否已关闭（装机后我们强制写 false）。 */
  telemetryOff: boolean;
  /** iPhone 通道在本机是否**有可能**可用（= macOS；真机是否配好要跑 --doctor）。 */
  iphoneEligible: boolean;
}

type RunResult = { code: number; out: string };

function run(cmd: string, args: string[], timeoutMs = 120_000): Promise<RunResult> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { windowsHide: true, env: process.env });
      let out = "";
      const timer = setTimeout(() => { try { child.kill(); } catch { /* 已退出 */ } }, timeoutMs);
      child.stdout?.on("data", (d) => { out += String(d); });
      child.stderr?.on("data", (d) => { out += String(d); });
      child.on("error", () => { clearTimeout(timer); resolve({ code: -1, out }); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out }); });
    } catch {
      resolve({ code: -1, out: "" });
    }
  });
}

/** 安装/运行用哪个 Python：自带的优先（不污染系统环境），没有再退回系统 python。 */
function pythonBin(): string {
  const bundled = bundledPython();
  if (bundled && existsSync(bundled)) return bundled;
  return process.platform === "win32" ? "python" : "python3";
}

/** pip 安装完成后 `phone-harness` 这个命令在本机的可执行位置（找不到就返回空串）。 */
function consoleScript(bin: string): string {
  const dir = path.dirname(bin);
  const win = path.join(dir, "Scripts", "phone-harness.exe");
  if (process.platform === "win32" && existsSync(win)) return win;
  const posix = path.join(dir, "bin", "phone-harness");
  if (existsSync(posix)) return posix;
  return "";
}

/**
 * 调一次 phone-harness CLI。⛔ 找不到 console script 时用 `python -c` 兜底
 * （pip 装在用户目录、Scripts 不在 PATH 上的情况很常见）。
 */
async function harness(args: string[], bin = pythonBin()): Promise<RunResult> {
  const exe = consoleScript(bin);
  if (exe) return run(exe, args);
  const code = `import sys; from phone_harness.run import main; sys.argv=["phone-harness", ${JSON.stringify(args).slice(1, -1)}]; main()`;
  return run(bin, ["-c", code]);
}

function skillFile(): string {
  return path.join(codexHome, "skills", SKILL_DIR_NAME, "SKILL.md");
}

export async function phoneHarnessStatus(): Promise<PhoneHarnessStatus> {
  const bin = pythonBin();
  const pyOk = await run(bin, ["-c", "import sys; print(sys.version.split()[0])"]).then((r) => r.code === 0);
  let installed = false;
  let version = "";
  if (pyOk) {
    const show = await run(bin, ["-m", "pip", "show", "phone-harness"]);
    installed = show.code === 0;
    version = (/^Version:\s*(\S+)/m.exec(show.out) ?? [])[1] ?? "";
  }
  const adb = await run("adb", ["version"]).then((r) => r.code === 0);
  let telemetryOff = false;
  if (installed) {
    const cfg = await harness(["config", "get", "telemetry"], bin);
    telemetryOff = /false/i.test(cfg.out);
  }
  let skill = false;
  try {
    const file = skillFile();
    skill = existsSync(file) || existsSync(file + ".disabled");
  } catch { /* codexHome 还没初始化 */ }
  return {
    platform: process.platform,
    python: bin,
    pythonOk: pyOk,
    installed,
    version,
    adb,
    skill,
    telemetryOff,
    iphoneEligible: process.platform === "darwin",
  };
}

/**
 * 安装：pip 装包（清华镜像）→ 关掉上游遥测 → 注册技能。
 * ⛔ 顺序不能反：先关遥测再注册技能，避免技能刚生效的那一两次调用把内容发出去。
 */
export async function installPhoneHarness(): Promise<{ ok: boolean; log: string }> {
  const bin = pythonBin();
  const log: string[] = [];
  const pip = await run(bin, ["-m", "pip", "install", "--no-input", "-i", PIP_INDEX, "phone-harness"], 900_000);
  log.push(`pip install → exit ${pip.code}`);
  if (pip.code !== 0) return { ok: false, log: log.concat(pip.out.slice(-1500)).join("\n") };

  const off = await harness(["config", "set", "telemetry", "false"], bin);
  log.push(`telemetry off → exit ${off.code}`);

  const skillOut = await harness(["skill"], bin);
  const text = skillOut.out.trim();
  if (skillOut.code === 0 && text.startsWith("---")) {
    const file = skillFile();
    // ⛔ 尊重用户的停用状态（与 builtin-skills 同源）：被停用就写进 .disabled，别静默启用。
    const target = existsSync(file + ".disabled") ? file + ".disabled" : file;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(target, text + "\n", "utf8");
    log.push(`skill → ${path.basename(target)}`);
  } else {
    log.push("skill → 未注册（CLI 没返回 SKILL.md，可稍后重试安装）");
  }
  return { ok: true, log: log.join("\n") };
}

/** 卸载：删技能文件（保留停用态语义）+ pip 卸载包。 */
export async function uninstallPhoneHarness(): Promise<{ ok: boolean; log: string }> {
  const log: string[] = [];
  try {
    const file = skillFile();
    await fs.rm(file, { force: true });
    await fs.rm(file + ".disabled", { force: true });
    log.push("skill removed");
  } catch { /* 没有就算了 */ }
  const pip = await run(pythonBin(), ["-m", "pip", "uninstall", "-y", "phone-harness"], 300_000);
  log.push(`pip uninstall → exit ${pip.code}`);
  return { ok: pip.code === 0, log: log.join("\n") };
}

/** 体检：直接跑上游 `phone-harness --doctor`，把结论原样带回去（不自己编造判定）。 */
export async function phoneHarnessDoctor(): Promise<{ ok: boolean; log: string }> {
  const r = await harness(["--doctor"], pythonBin());
  return { ok: r.code === 0, log: r.out.slice(-4000) };
}

/** macOS 的 iPhone 通道要这两个权限；引导页按平台给步骤（见渲染层）。 */
export function phoneHarnessGuides(): Array<{ id: string; title: string; steps: string[] }> {
  const android = {
    id: "android",
    title: "Android 通道（Windows / Linux / macOS 都可用）",
    steps: [
      "手机上：设置 → 关于手机 → 连点「版本号」7 次打开开发者选项",
      "开发者选项里打开「USB 调试」；用 USB 线接电脑，手机上点「允许 USB 调试」",
      "回到本页点「体检」，看到 adb 与设备就绪即可；无线调试用 `phone-harness android pair <配对码>`",
    ],
  };
  if (process.platform !== "darwin") return [android];
  return [
    android,
    {
      id: "iphone",
      title: "iPhone 通道（仅 macOS，经 iPhone 镜像窗口）",
      steps: [
        "Mac 上打开「iPhone 镜像」并连接你的 iPhone（首次需要在手机上确认）",
        "系统设置 → 隐私与安全性 → 辅助功能：勾选本应用；屏幕录制：同样勾选",
        "iPhone 解锁时会暂停镜像；跑任务前先解锁并停在要用的界面",
        "回到本页点「体检」确认 iPhone 窗口能被识别",
      ],
    },
  ];
}

/** 打开系统权限设置页（macOS 用 open，Windows 用 ms-settings），引导里给按钮用。 */
export async function openPhoneHarnessSettings(): Promise<void> {
  if (process.platform === "darwin") {
    await run("open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"]);
    return;
  }
  if (process.platform === "win32") {
    await run("cmd", ["/c", "start", "ms-settings:privacy"]);
    return;
  }
  await run("xdg-open", ["https://developer.android.com/tools/adb"]);
}

export const phoneHarnessAppName = app.name;
