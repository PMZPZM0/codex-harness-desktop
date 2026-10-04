/**
 * 声明式插件的清单与启停域（10-04 阶段 6 B 档）。
 *
 * ⛔ 为什么单独一个域而不塞进 `domains`：`domains` 管的是**宿主自己的功能域**
 *   （编译期就在包里的 79 个），本域管的是**外部清单**（用户目录里随时能放的 JSON）。
 *   两者的信任级别不同（一个是我方代码，一个是外部输入），混在一起会让
 *   "清单校验失败"与"域加载失败"互相干扰，且将来要给外部插件单独做沙箱时无处安放。
 *   一板块一前缀（守卫【253】）。
 *
 * 通道 3 条：
 *   declared-plugins:list   —— 读清单（含无效条目报告 + 两个目录路径）
 *   declared-plugins:toggle —— 启停某个声明式插件
 *   declared-plugins:open-dirs —— 打开两个插件目录（用宿主自带的文件管理器）
 */
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";
import { loadDeclaredPlugins, KNOWN_SLOTS, type DeclaredPlugin } from "../declared-plugins";
import type { DeclaredPluginsResult } from "../declared-plugin-types";
import { readAppSettingsSync, saveAppSettings } from "../app-settings";

const CHANNELS = ["declared-plugins:list", "declared-plugins:toggle", "declared-plugins:open-dirs"];

/**
 * 两个清单目录（**惰性**）。
 *
 * ⛔ 路径判定必须惰性：`app.setPath("userData", …)` 在 main.ts 模块体，而本域在
 *   组合表里 import 早于它（守卫【91】）。模块体算路径 = 拿到默认目录而静默漂移。
 *
 * ⚠️ 为什么要分开两个目录：
 *   builtin = 跟包走、可审计、用户改不了内容（改也要重装）
 *   user    = 用户自己放的，优先级更高（能覆盖同名内置插件的参数）
 * 混成一个目录的话，"用户改坏了内置插件"与"用户装了个新插件"就分不清了。
 */
function dirs(): { builtinDir: string; userDir: string } {
  const root = path.join(app.getAppPath(), "electron", "declared-plugins");
  const user = path.join(app.getPath("userData"), "codex-home", "harness-plugins");
  return { builtinDir: root, userDir: user };
}

function disabledSet(): Set<string> {
  try {
    const s = readAppSettingsSync(app.getPath("userData"));
    const raw = s.disabledDeclaredPlugins;
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

export const declaredPluginsFeature = defineFeature<null>({
  id: "declared-plugins",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    const host = ctx.get<HostCaps>("host")!;
    if (!ipcHost) throw new Error("declared-plugins: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("declared-plugins:list", (): DeclaredPluginsResult => {
      const { builtinDir, userDir } = dirs();
      const { plugins, issues } = loadDeclaredPlugins(builtinDir, userDir);
      const off = disabledSet();
      return {
        plugins: plugins.map((p) => ({ ...p, enabled: p.enabled && !off.has(p.id) })),
        issues,
        builtinDir,
        userDir,
        disabledIds: [...off],
        knownSlots: [...KNOWN_SLOTS],
      };
    });

    ipcHost.handle("declared-plugins:toggle", async (_event, input: { id?: string; enabled?: boolean }) => {
      const id = String(input?.id ?? "");
      if (!id) return { ok: false, error: "缺少插件 id" };
      const { builtinDir, userDir } = dirs();
      const { plugins } = loadDeclaredPlugins(builtinDir, userDir);
      // ⛔ 必须先确认这个 id 真的存在：否则任何渲染层都能往设置里塞垃圾 id
      //   （渲染层可被注入，这是【269】同款理由）。
      if (!plugins.some((p: DeclaredPlugin) => p.id === id)) {
        return { ok: false, error: `未安装的声明式插件：${id}` };
      }
      const userData = app.getPath("userData");
      const off = disabledSet();
      if (input?.enabled === false) off.add(id);
      else off.delete(id);
      // 先落盘再回包：只有一份真相源，没有"内存态"要对账
      await saveAppSettings(userData, { disabledDeclaredPlugins: [...off].sort() });
      // ⛔ 声明式插件是**真热插拔**（与功能域不同）：渲染层插槽即时刷新，
      //   无需重启 —— 这是它相对"只写配置不动运行时"的旧实现的关键差别。
      return { ok: true, id, enabled: input?.enabled !== false, requiresRestart: false };
    });

    ipcHost.handle("declared-plugins:open-dirs", async () => {
      const { builtinDir, userDir } = dirs();
      // 用户目录不存在就建一个 —— 否则"让你把 JSON 放进去"却没目录可放
      try {
        await fs.mkdir(userDir, { recursive: true });
      } catch (error) {
        return { ok: false, error: `创建用户插件目录失败：${error instanceof Error ? error.message : String(error)}` };
      }
      // 只开用户目录：内置目录是程序文件，改它没有意义（要改请重装）
      await host.shell.openPath(userDir);
      return { ok: true, userDir, builtinDir };
    });

    ctx.effect(() => {
      for (const ch of CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});