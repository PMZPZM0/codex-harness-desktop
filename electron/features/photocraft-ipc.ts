/**
 * photocraft-ipc（11-15）—— PhotoCraft（纯 Rust 的 Photoshop 重写）宿主域。
 *
 * 域：photocraft(7)
 * 通道：status / info / convert / run / batch / commands / open
 *
 * ⛔ 所有文件参数必须落在可信根（会话工作目录 / userData）或 `photocraft-io` 内；
 *    命令参数是外部输入：命令 id 走白名单正则、params 有字节上限、一律 spawn 参数数组不开 shell。
 * ⛔ 输出文件不得与输入同路径（避免把用户原图就地覆盖）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { isInsideOrEqualTrustedRoots } from "../runtime-refs";
import {
  PHOTOCRAFT_HOME,
  openPhotoCraftGui,
  photocraftCliPath,
  photocraftGuiPath,
  photocraftInstalledVersion,
  photocraftMcpRegistered,
  photocraftPaths,
  runPhotoCraftCli,
} from "../photocraft";
import { dirSizeBytes } from "../toolchain";

const PHOTOCRAFT_CHANNELS = ["photocraft:status", "photocraft:info", "photocraft:convert", "photocraft:run", "photocraft:batch", "photocraft:commands", "photocraft:open"];
const COMMAND_ID = /^[a-z][a-zA-Z0-9_.]{1,80}$/;

/** 可信路径闸：会话工作目录 / userData / 用户选过的路径，或 PhotoCraft 专用收发目录。 */
function assertAllowed(target: string, label: string): string {
  const resolved = path.resolve(String(target ?? ""));
  if (!resolved) throw new Error(`${label}为空`);
  const ioRoot = path.resolve(photocraftPaths().ioRoot);
  const insideIo = resolved === ioRoot || resolved.startsWith(ioRoot + path.sep);
  if (!insideIo && !isInsideOrEqualTrustedRoots(resolved)) {
    throw new Error(`${label}不在允许目录内（会话工作目录 / 应用数据目录）`);
  }
  return resolved;
}

type Step = { id?: unknown; cmd?: unknown; params?: unknown };

/** 校验命令步骤（id 白名单 + 参数上限）并序列化成 CLI 的 `--cmd/--params` 或 actions 文件。 */
function normalizeSteps(steps: unknown): Array<{ id: string; params: Record<string, unknown> }> {
  if (!Array.isArray(steps) || !steps.length) throw new Error("commands 不能为空");
  if (steps.length > 20) throw new Error("一次最多 20 条命令（需要更多请拆成多次调用）");
  let total = 0;
  return steps.map((raw, index) => {
    const step = (raw ?? {}) as Step;
    const id = String(step.id ?? step.cmd ?? "").trim();
    if (!COMMAND_ID.test(id)) throw new Error(`第 ${index + 1} 条命令 id 不合法：${id || "(空)"}`);
    const params = (step.params ?? {}) as Record<string, unknown>;
    if (typeof params !== "object" || Array.isArray(params)) throw new Error(`第 ${index + 1} 条命令参数必须是对象`);
    const text = JSON.stringify(params);
    if (text.length > 8192) throw new Error(`第 ${index + 1} 条命令参数过大（>8KB）`);
    total += text.length;
    if (total > 65536) throw new Error("全部命令参数合计过大（>64KB）");
    return { id, params };
  });
}

export const photocraftFeature = defineFeature<null>({
  id: "photocraft",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("photocraft: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("photocraft:status", async () => {
      const paths = photocraftPaths();
      const installed = Boolean(photocraftCliPath());
      return {
        installed,
        version: photocraftInstalledVersion(),
        cliPath: installed ? paths.cli : "",
        guiPath: installed ? photocraftGuiPath() : "",
        ioRoot: paths.ioRoot,
        mcpRegistered: photocraftMcpRegistered(),
        platform: process.platform,
        sizeBytes: installed ? dirSizeBytes(paths.root) : 0,
        attribution: { license: "MIT OR Apache-2.0", home: PHOTOCRAFT_HOME },
      };
    });

    ipcHost.handle("photocraft:info", async (_event, input: { path?: string } = {}) => {
      const target = assertAllowed(String(input?.path ?? ""), "输入文件");
      const { stdout } = await runPhotoCraftCli(["info", "--compact", target], 60_000);
      try { return JSON.parse(stdout); } catch { return { raw: stdout.slice(0, 20000) }; }
    });

    ipcHost.handle("photocraft:convert", async (_event, input: { path?: string; out?: string; quality?: number } = {}) => {
      const source = assertAllowed(String(input?.path ?? ""), "输入文件");
      const target = assertAllowed(String(input?.out ?? ""), "输出文件");
      if (path.resolve(source).toLowerCase() === path.resolve(target).toLowerCase()) throw new Error("输出不能与输入同一路径（会覆盖原图）；请另存为新文件");
      const args = ["convert", source, target];
      const quality = Number(input?.quality);
      if (Number.isFinite(quality)) args.push("--quality", String(Math.max(1, Math.min(100, Math.round(quality)))));
      await runPhotoCraftCli(args, 180_000);
      return { ok: true, path: target };
    });

    ipcHost.handle("photocraft:run", async (_event, input: { path?: string; out?: string; commands?: Step[] } = {}) => {
      const source = assertAllowed(String(input?.path ?? ""), "输入文件");
      const target = assertAllowed(String(input?.out ?? ""), "输出文件");
      if (path.resolve(source).toLowerCase() === path.resolve(target).toLowerCase()) throw new Error("输出不能与输入同一路径（会覆盖原图）；请另存为新文件");
      const steps = normalizeSteps(input?.commands);
      const args = ["run", source];
      for (const step of steps) args.push("--cmd", step.id, "--params", JSON.stringify(step.params));
      args.push("--out", target);
      const { stdout } = await runPhotoCraftCli(args, 300_000);
      const lines = stdout.split(/\r?\n/).filter(Boolean).slice(0, 40).map((line) => {
        try {
          const parsed = JSON.parse(line) as { command?: string; result?: unknown };
          return `${parsed.command ?? "?"} → ${parsed.result == null ? "ok" : JSON.stringify(parsed.result).slice(0, 300)}`;
        } catch { return line.slice(0, 300); }
      });
      return { ok: true, path: target, commands: steps.map((step) => step.id), log: lines };
    });

    ipcHost.handle("photocraft:batch", async (_event, input: { input?: string; outDir?: string; commands?: Step[]; format?: string; recursive?: boolean } = {}) => {
      const source = assertAllowed(String(input?.input ?? ""), "输入目录");
      const outDir = assertAllowed(String(input?.outDir ?? ""), "输出目录");
      if (path.resolve(source).toLowerCase() === path.resolve(outDir).toLowerCase()) throw new Error("输出目录不能与输入目录相同");
      const steps = normalizeSteps(input?.commands);
      const workDir = photocraftPaths().ioRoot;
      await fs.mkdir(workDir, { recursive: true });
      const actionsFile = path.join(workDir, `batch-${Date.now()}.json`);
      const actions = steps.map((step) => [step.id, step.params]);
      await fs.writeFile(actionsFile, JSON.stringify(actions, null, 2), "utf8");
      try {
        const args = ["batch", "--actions", actionsFile, "--in", source, "--out", outDir];
        const format = String(input?.format ?? "").trim();
        if (format) args.push("--format", format);
        if (input?.recursive === true) args.push("--recursive");
        await runPhotoCraftCli(args, 600_000);
        return { ok: true, outDir, commands: steps.map((step) => step.id) };
      } finally {
        await fs.rm(actionsFile, { force: true }).catch(() => undefined);
      }
    });

    ipcHost.handle("photocraft:commands", async (_event, input: { filter?: string } = {}) => {
      const args = ["commands", "--json"];
      const filter = String(input?.filter ?? "").trim();
      if (filter) args.push("--filter", filter);
      const { stdout } = await runPhotoCraftCli(args, 120_000);
      try {
        const list = JSON.parse(stdout) as Array<{ id?: string; label?: string }>;
        return { total: list.length, items: list.slice(0, 500) };
      } catch {
        return { total: 0, items: [], raw: stdout.slice(0, 20000) };
      }
    });

    ipcHost.handle("photocraft:open", async (_event, input: { path?: string } = {}) => {
      const file = String(input?.path ?? "").trim();
      if (file) assertAllowed(file, "文件");
      return openPhotoCraftGui(file || undefined);
    });

    ctx.effect(() => {
      for (const channel of PHOTOCRAFT_CHANNELS) ipcHost.removeHandler(channel);
    });
  },
});
