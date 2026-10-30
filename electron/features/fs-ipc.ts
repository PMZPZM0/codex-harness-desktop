/**
 * fs-ipc —— **受信任根约束的本地文件读写**（写 / 读预览 / 存在性探测 / 定位文件）
 *
 * 域：fs(5)
 * 通道：fs:write / fs:read / fs:exists / fs:reveal / fs:locate
 *
 * ── 10-03：改为插件形态 + 接缝化（方案 §6 阶段 2/3）────────────────────────
 * 与 `remote-ipc` 同款改造，但多一步：原来直接 `import { shell } from "electron"`，
 * 现在经 `inject: ["ipc", "host"]` 取 `host.shell`。
 *
 * ⛔⛔ **10-29 用户令（改变了 09-19 的收敛口径，是用户的明确决定，不是回退事故）**：
 *   「不用授权弹窗，文件预览联动可以直接看和编辑，不管哪里的文件，都要可以预览和编辑」。
 *   ⇒ 本域四条通道（写 / 读 / 探测 / 定位）**不再判可信根**，任意绝对路径直通。
 *   仍然保留的最小约束：`fs:write` 忽略渲染层传入的 root（原可被 root:"C:\\" 绕过）、
 *   读有 2MB 预览上限、定位要求是真文件。
 *   ⛔ 可信根判定仍然存在且仍在内核（`isInsideTrustedRoots`）—— 它现在只管**落盘 / 资产 / 协议**类
 *   通道（对话框另存、短剧素材、成片输出、HTML 预览源），别把两者混为一谈。
 *
 * ⛔ `fileStat` / `sizeLabel` 来自 `./app-diagnostics`（同域族的文件 stat 与体积可读化）。
 *    ⚠️ app-diagnostics 目前仍是裸域（同批改），改它时本文件的 import 要跟着核对。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileStat, sizeLabel } from "./app-diagnostics";
import { locateFile } from "../file-locate";
import { threadCwd } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";

const FS_CHANNELS = ["fs:write", "fs:read", "fs:exists", "fs:reveal", "fs:locate"];

/** 预览路径归一（10-18 修「换个目录就打不开」）：去首尾空白与包裹引号；file:// 解 URI；
 *  ~ 展开家目录；**相对路径按会话工作目录解析**（原来用 process.cwd() = 应用目录，必然找不到）。 */
function resolvePreviewPath(raw: string, threadId?: string): { abs: string; base: string } {
  let s = String(raw ?? "").trim().replace(/^["']|["']$/g, "");
  if (s.startsWith("file://")) {
    try { s = decodeURIComponent(new URL(s).pathname); if (/^\/[A-Za-z]:/.test(s)) s = s.slice(1); } catch { /* 保持原样 */ }
  }
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    if (home) s = path.join(home, s.slice(1));
  }
  if (path.isAbsolute(s)) return { abs: path.normalize(s), base: "" };
  const cwd = (threadId ? threadCwd.get(threadId) : undefined) || process.cwd();
  return { abs: path.resolve(cwd, s), base: cwd };
}

export const fsFeature = defineFeature<null>({
  id: "fs",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    const host = ctx.get<HostCaps>("host");
    if (!ipcHost) throw new Error("fs: 缺少 ipc 服务（宿主未提供）");
    if (!host) throw new Error("fs: 缺少 host 接缝（宿主未提供）");

    ipcHost.handle("fs:write", async (_event, input: { path: string; content: string; root: string }) => {
      /* ⛔ 10-29 用户令：编辑器保存不再判可信根（工作区外的文件也要能改）。
         ⚠️ 仍然**忽略**渲染层传入的 `root` —— 它从来不是校验依据，只是历史参数。 */
      const resolved = path.resolve(input.path);
      await fs.writeFile(resolved, input.content, "utf8");
      return { ok: true };
    });
    // 本地读文件：预览文件内容（Base64 返回，渲染层解码）。取代转发给引擎的 fs/readFile——
    // 引擎的 fs/readFile 是给 AI 用的工具，非任务上下文会失败或返回结构不一致。
    ipcHost.handle("fs:read", async (_event, input: { path: string; threadId?: string }) => {
      const { abs: target } = resolvePreviewPath(input.path, input.threadId);
      // ⛔ 隐私加固（09-19 审计高危）：预览通道原来是"任意路径读"——渲染层被注入（XSS）即可
      // 读全盘文件（含系统敏感目录）。收敛到可信根：会话工作目录、userData、用户选过的路径。
      // 口径与 harness-image 协议（09-13 审计 S5）完全一致，合法预览不受影响。
      /* ⛔ 10-29 用户令：预览读取不再判可信根、也不再弹授权（任意文件直接可看）。 */
      const stat = fileStat(target);
      if (!stat || !stat.isFile()) throw new Error(`文件不存在或不可读：${input.path}`);
      const size = stat.size;
      if (size > 2 * 1024 * 1024) throw new Error(`文件过大（${sizeLabel(size)}），预览仅支持 2MB 以内`);
      const buf = await fs.readFile(target);
      return { dataBase64: buf.toString("base64"), size };
    });
    /* 10-29：`fs:allow` 已删除 —— 预览 / 编辑不再需要授权，这条通道没有调用方了。
       （历史遗留的 `userData/trusted-paths.json` 仍会被读取，供其余资产类闸门认旧授权。） */
    /* 探测文件是否存在（InlineFileCards 用：不存在的引用文件灰显，点击不再直接报 os error 2） */
    ipcHost.handle("fs:exists", async (_event, input: { path: string }) => {
      try {
        const target = path.resolve(input.path);
        const stat = fileStat(target);
        return { exists: Boolean(stat && stat.isFile()) };
      } catch {
        return { exists: false };
      }
    });
    // 在系统资源管理器中定位文件（09-28 画布闭环：生成产物此前只有路径文本，用户找不到实体文件）。
    // 口径同 fs:read：可信根内的文件才允许定位（防把资源管理器当探测工具用）。
    ipcHost.handle("fs:reveal", async (_event, input: { path: string }) => {
      /* ⛔ 10-29 用户令：定位也不再判可信根（预览已放开，定位跟着放开）。 */
      const target = path.resolve(input.path);
      const stat = await fs.stat(target).catch(() => null);
      if (!stat || !stat.isFile()) throw new Error(`文件不存在：${input.path}`);
      host.shell.showItemInFolder(target);
      return { ok: true };
    });

    /* ★ 10-30 用户令：「只要是电脑上有的文件，不管在哪里都能打开，这个路径错」——
       卡片手里的路径常常是**按会话目录拼出来的死链**（模型实际在另一个仓里改这个文件）。
       ⇒ 这条通道只做一件事：**按文件名把真实文件找回来**（判定全在 ../file-locate：
       同名 + 尾段打分 + 有界预算）。⛔ 它不读内容、不写、不返回目录，只回一条路径。 */
    ipcHost.handle("fs:locate", async (_event, input: { path: string; threadId?: string }) => {
      const { abs } = resolvePreviewPath(String(input?.path ?? ""), input?.threadId);
      const direct = fileStat(abs);
      if (direct && direct.isFile()) return { path: abs };
      return { path: await locateFile(abs) };
    });

    // 卸载即摘通道（插件容器的可逆副作用语义）
    ctx.effect(() => {
      for (const ch of FS_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
