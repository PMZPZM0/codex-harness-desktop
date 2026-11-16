/**
 * artcraft-ipc（11-16）—— Craft 全家桶（ArtCraft Launcher）宿主域。
 *
 * 域：artcraft(4)
 * 通道：status / open / sync / run
 *
 * ⛔ Launcher 只负责装 App；宿主不代装、不代卸（UAC 与安装目录由它处理）。
 * ⛔ 工具按 App 拆开（用户令「跟 PhotoCraft 一样，都单独」）：每个已装 App 各自一条
 *    `[mcp_servers.<id>]`（由 custom-model-apply 生成）+ 一个独立 Codex 工具 `craft_<id>`；
 *    这里只提供它们的执行端 `artcraft:run`。
 * ⛔ 所有文件参数必须落在可信根（会话工作目录 / userData）内；输出不得覆盖输入；不开 shell。
 */
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { isInsideOrEqualTrustedRoots } from "../runtime-refs";
import {
  ARTCRAFT_APPS_HOME,
  ARTCRAFT_HOME,
  artcraftInstalledVersion,
  artcraftLauncherPath,
  artcraftPaths,
  craftAppMcpServers,
  listInstalledCraftApps,
  openArtCraftLauncher,
  openCraftApp,
  runCraftAppCli,
} from "../artcraft";
import { dirSizeBytes } from "../toolchain";

const ARTCRAFT_CHANNELS = ["artcraft:status", "artcraft:open", "artcraft:sync", "artcraft:run"];
const COMMAND_ID = /^[a-z][a-zA-Z0-9_.]{1,80}$/;

/** 可信路径闸：会话工作目录 / userData / 用户选过的路径。 */
function assertAllowed(target: string, label: string): string {
  const resolved = path.resolve(String(target ?? ""));
  if (!resolved) throw new Error(`${label}为空`);
  if (!isInsideOrEqualTrustedRoots(resolved)) throw new Error(`${label}不在允许目录内（会话工作目录 / 应用数据目录）`);
  return resolved;
}

type Step = { id?: unknown; cmd?: unknown; params?: unknown };

/** 校验命令步骤（id 白名单 + 单条 8KB / 合计 20KB）。口径与 PhotoCraft 一致。 */
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
    if (total > 20000) throw new Error("全部命令参数合计过大（>20KB，Windows 命令行上限）；请拆成多次调用");
    return { id, params };
  });
}

/** 网关刚出现 / App 增减后立刻重写 config.toml（与 PhotoCraft 的时刻链同款）。 */
async function rewriteConfig(): Promise<void> {
  try {
    const { readCustomModel } = await import("../main/01-model-catalog");
    const { applyCustomModel } = await import("./custom-model-apply");
    const model = await readCustomModel();
    if (model) await applyCustomModel(model, { restart: false });
  } catch { /* 没有模型档案时跳过：下一次启动 applyCustomModel 会按安装状态收敛 */ }
}

type RunInput = {
  app?: string;
  action?: string;
  path?: string;
  out?: string;
  commands?: Step[];
  filter?: string;
  quality?: number;
};

export const artcraftFeature = defineFeature<null>({
  id: "artcraft",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("artcraft: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("artcraft:status", async () => {
      const paths = artcraftPaths();
      const installed = Boolean(artcraftLauncherPath());
      return {
        installed,
        version: artcraftInstalledVersion(),
        launcherPath: installed ? paths.launcher : "",
        platform: process.platform,
        sizeBytes: installed ? dirSizeBytes(paths.root) : 0,
        /* Launcher 里装过的 App（装完回来自动联动）+ 已写入的独立 MCP 名单。 */
        installedApps: await listInstalledCraftApps(),
        mcpServers: craftAppMcpServers(),
        attribution: { license: "MIT OR Apache-2.0", home: ARTCRAFT_HOME, apps: ARTCRAFT_APPS_HOME },
      };
    });

    ipcHost.handle("artcraft:open", async () => openArtCraftLauncher());

    /** 重新扫描已装 App 并重写 config（每个 App 一条独立 MCP 段）；引擎需重启才加载。 */
    ipcHost.handle("artcraft:sync", async () => {
      await rewriteConfig();
      return { servers: craftAppMcpServers() };
    });

    /** 独立工具 `craft_<id>` 的执行端：把 App 自己的 CLI 包一层（不起 shell）。 */
    ipcHost.handle("artcraft:run", async (_event, input: RunInput = {}) => {
      const app = String(input?.app ?? "").trim();
      if (!/^[a-z0-9]{2,40}$/.test(app)) throw new Error(`app 不合法：${app || "(空)"}`);
      const action = String(input?.action ?? "status");
      if (action === "status") {
        const installed = (await listInstalledCraftApps()).find((entry) => entry.id === app);
        if (!installed) return { ok: false, missing: true, text: `没找到已安装的 App「${app}」：请先在 Craft 全家桶里用 Launcher 安装` };
        return { ok: true, text: `${installed.name}${installed.version ? ` v${installed.version}` : ""}\n路径：${installed.exePath}\nCLI：${installed.cliPath || "（缺失）"}` };
      }
      if (action === "open") {
        const file = String(input?.path ?? "").trim();
        if (file) assertAllowed(file, "文件");
        return openCraftApp(app, file || undefined);
      }
      if (action === "commands") {
        const filter = String(input?.filter ?? "").trim();
        const args = ["commands"];
        if (filter) args.push("--filter", filter);
        let run;
        try { run = await runCraftAppCli(app, [...args, "--json"], 120_000); }
        catch { run = await runCraftAppCli(app, args, 120_000); }
        return { ok: true, text: run.stdout.slice(0, 24000) };
      }
      if (action === "info") {
        const target = assertAllowed(String(input?.path ?? ""), "输入文件");
        let run;
        try { run = await runCraftAppCli(app, ["info", "--compact", target], 60_000); }
        catch { run = await runCraftAppCli(app, ["info", target], 60_000); }
        return { ok: true, text: run.stdout.slice(0, 20000) };
      }
      if (action === "convert") {
        const source = assertAllowed(String(input?.path ?? ""), "输入文件");
        const target = assertAllowed(String(input?.out ?? ""), "输出文件");
        if (source.toLowerCase() === target.toLowerCase()) throw new Error("输出不能与输入同一路径（会覆盖原文件）；请另存为新文件");
        const args = ["convert", source, target];
        const quality = Number(input?.quality);
        if (Number.isFinite(quality)) args.push("--quality", String(Math.max(1, Math.min(100, Math.round(quality)))));
        const run = await runCraftAppCli(app, args, 180_000);
        return { ok: true, text: `已转换：${target}${run.stdout.trim() ? `\n${run.stdout.trim().slice(-2000)}` : ""}` };
      }
      if (action === "run") {
        const source = assertAllowed(String(input?.path ?? ""), "输入文件");
        const target = assertAllowed(String(input?.out ?? ""), "输出文件");
        if (source.toLowerCase() === target.toLowerCase()) throw new Error("输出不能与输入同一路径（会覆盖原文件）；请另存为新文件");
        const steps = normalizeSteps(input?.commands);
        const args = ["run", source];
        for (const step of steps) args.push("--cmd", step.id, "--params", JSON.stringify(step.params));
        args.push("--out", target);
        const run = await runCraftAppCli(app, args, 300_000);
        return { ok: true, text: `已完成：${target}\n命令：${steps.map((step) => step.id).join(" → ")}${run.stdout.trim() ? `\n${run.stdout.trim().slice(-2000)}` : ""}` };
      }
      return { ok: false, text: `未知 action：${action}（可用：status / commands / info / run / convert / open）` };
    });

    ctx.effect(() => {
      for (const channel of ARTCRAFT_CHANNELS) ipcHost.removeHandler(channel);
    });
  },
});
