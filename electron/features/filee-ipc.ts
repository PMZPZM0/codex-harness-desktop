/**
 * filee-ipc（10-30）—— Filee 文件转换的宿主侧执行端
 *
 * 域：filee(2)
 * 通道：filee:status / filee:convert
 *
 * 背景：Filee（KnifeLemon/Filee，MIT）是本地文件格式转换器，244 种格式离线互转，
 * 装在「设置 → 开发工具 → Filee 文件转换」（GitHub release 直下型，见 runtime-ipc 的
 * installFileeFromGitHub）。本域把它的 CLI（filee-cli.exe）接成 Codex 的 filee_convert 工具。
 *
 * ⛔ CLI 一律**参数数组** spawn，不拼 shell（模型传入的路径是外部输入 = 注入面，同 feishu-cli 口径）。
 * ⛔ convert 必须带 `--json`：结构化结果（converted/skipped/failed/files[].outputs）是唯一可靠判据；
 *   逐行人读 stdout 会在「跳过/失败混在一起」时给出错误结论（10-30 实测 --json 输出单份纯 JSON）。
 * ⛔ CLI 的 exit code 语义（filee 官方）：0=无失败（可有跳过）1=有失败/取消 2=参数错 3=无内容可转。
 *   **1 不算宿主工具坏** —— 把 JSON 里的 failed 明细原样回给模型，让它自己决定下一步。
 * ⛔ 直通口径（同 fs-ipc 10-29 用户令）：输入路径不判可信根 —— 模型替用户转文件，用户指哪转哪。
 */
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { toolRootsRead } from "../toolchain";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

/** CLI 可执行文件（win / mac·linux 布局分叉；marker 的单一真相源在 dev-runtimes.filee） */
function cliPath(): string {
  const rel = process.platform === "win32" ? path.join("filee", "filee-cli.exe") : path.join("filee", "filee-cli");
  for (const root of toolRootsRead()) {
    try { if (root) { const candidate = path.join(root, rel); if (existsSync(candidate)) return candidate; } } catch { /* 下一个落位 */ }
  }
  return "";
}

const MAX_OUTPUT = 32_000;

type FileeStatus = { installed: boolean; path: string; version: string; detail: string };

/** `--version` 缓存 60 秒（状态卡片轮询时别每次 spawn 一倍进程，同 feishu-cli 口径）。 */
let versionCache = { value: "", at: 0 };

async function statusOf(): Promise<FileeStatus> {
  const binary = cliPath();
  const base: FileeStatus = { installed: Boolean(binary), path: binary, version: "", detail: "" };
  if (!binary) return base;
  try {
    if (!versionCache.value || Date.now() - versionCache.at > 60_000) {
      const text = await new Promise<string>((resolve) => {
        const child = spawn(binary, ["--version"], { windowsHide: true });
        let out = "";
        child.stdout?.on("data", (c) => { out += String(c); });
        child.stderr?.on("data", (c) => { out += String(c); });
        const timer = setTimeout(() => { try { child.kill(); } catch { /* 已退出 */ } resolve(""); }, 10_000);
        child.on("error", () => { clearTimeout(timer); resolve(""); });
        child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 ? out.trim() : ""); });
      });
      // 输出形如 `filee 2.2.0` —— 取最后一段当版本号
      const version = text.split(/\s+/).pop() || "";
      if (/^[0-9][0-9A-Za-z.\-]*$/.test(version)) versionCache = { value: version, at: Date.now() };
    }
    base.version = versionCache.value;
  } catch { /* 版本拿不到不算致命 */ }
  return base;
}

export type FileeConvertInput = {
  /** 要转换的文件路径（1~64 个；目录要配 recursive:true） */
  inputs: string[];
  /** 目标格式（扩展名或格式 id，如 jpg / pdf / docx / mp3） */
  to: string;
  /** 输出目录（缺省 = 源文件旁边，CLI 原生行为） */
  outputDir?: string;
  /** 有损图像质量 1-100（jpg/webp/avif 等） */
  quality?: number;
  /** 覆盖已存在的输出（缺省 = 自动编号） */
  overwrite?: boolean;
  /** 包含子目录（inputs 是目录时用） */
  recursive?: boolean;
  /** 保留原文件的创建/修改时间 */
  keepDates?: boolean;
  /** 超时毫秒（视频等大转换可能很久；缺省 10 分钟） */
  timeoutMs?: number;
};

export type FileeConvertResult = {
  ok: boolean;
  code: number;
  /** CLI --json 的原文解析（解析失败时为 null，error/raw 兜底） */
  report: { preset?: string; target?: string; converted?: number; skipped?: number; failed?: number; files?: { source?: string; state?: string; outputs?: string[]; error?: string }[] } | null;
  error: string;
  raw: string;
};

async function convert(input: FileeConvertInput): Promise<FileeConvertResult> {
  const binary = cliPath();
  if (!binary) {
    return { ok: false, code: -1, report: null, error: "Filee 还没安装：请到「设置 → 开发工具 → Filee 文件转换」点安装后再试。", raw: "" };
  }
  const inputs = (Array.isArray(input.inputs) ? input.inputs : []).map((p) => String(p ?? "").trim()).filter(Boolean);
  if (!inputs.length) return { ok: false, code: 2, report: null, error: "缺少要转换的文件路径（inputs 至少一项）", raw: "" };
  const to = String(input.to ?? "").trim().replace(/^\./, "");
  if (!to) return { ok: false, code: 2, report: null, error: "缺少目标格式（to，如 jpg / pdf / docx）", raw: "" };
  if (inputs.length > 64) return { ok: false, code: 2, report: null, error: "一次最多转换 64 个文件（拆成几批再试）", raw: "" };

  const args = ["convert", ...inputs, "--to", to, "--json"];
  const outDir = String(input.outputDir ?? "").trim();
  if (outDir) args.push("-o", outDir);
  if (typeof input.quality === "number" && Number.isFinite(input.quality)) {
    args.push("--quality", String(Math.max(1, Math.min(100, Math.round(input.quality)))));
  }
  if (input.overwrite) args.push("--overwrite");
  if (input.recursive) args.push("--recursive");
  if (input.keepDates) args.push("--keep-dates");

  const timeoutMs = Math.max(5_000, Math.min(30 * 60_000, Number(input.timeoutMs) || 600_000));
  const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      cwd: os.homedir(),
    });
    let stdout = "";
    let stderr = "";
    const cap = (v: string) => (v.length > MAX_OUTPUT ? v.slice(0, MAX_OUTPUT) + "\n…（输出过长已截断）" : v);
    const timer = setTimeout(() => { try { child.kill(); } catch { /* 已退出 */ } }, timeoutMs);
    child.stdout?.on("data", (c) => { stdout = cap(stdout + String(c)); });
    child.stderr?.on("data", (c) => { stderr = cap(stderr + String(c)); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });

  // --json 输出单份 JSON；容错：从 stdout 里抠第一个 { 到最后一个 }（防 CLI 前后夹了进度行）
  let report: FileeConvertResult["report"] = null;
  const text = String(result.stdout ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { report = JSON.parse(text.slice(start, end + 1)); } catch { /* raw 兜底 */ }
  }
  const ok = result.code === 0;
  const failedItems = (report?.files ?? []).filter((f) => f?.state && f.state !== "done");
  let error = "";
  if (result.code === 2) error = String(result.stderr || result.stdout || "").trim().slice(0, 400) || "参数错误（未知格式 / 输入缺失）";
  else if (result.code === 3) error = "没有可转换的内容（输入里没有能转到该格式的文件）";
  else if (result.code === 1) error = failedItems.length ? `有 ${failedItems.length} 个文件转换失败：` + failedItems.slice(0, 4).map((f) => `${path.basename(String(f.source ?? ""))}${f.error ? `（${String(f.error).slice(0, 120)}）` : ""}`).join("；") : String(result.stderr || "").trim().slice(0, 400) || "有文件转换失败";
  else if (!ok && !report) error = String(result.stderr || result.stdout || result.code).trim().slice(0, 600);
  return { ok, code: result.code, report, error, raw: (result.stdout + (result.stderr ? `\n[stderr] ${result.stderr}` : "")).slice(0, MAX_OUTPUT) };
}

const FILEE_CHANNELS = ["filee:status", "filee:convert"];

export const fileeFeature = defineFeature<null>({
  id: "filee",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("filee: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("filee:status", async () => statusOf());
    ipcHost.handle("filee:convert", async (_e, input: FileeConvertInput) => convert(input));

    ctx.effect(() => {
      for (const ch of FILEE_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
