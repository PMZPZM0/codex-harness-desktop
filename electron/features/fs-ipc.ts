/**
 * fs-ipc —— **受信任根约束的本地文件读写**（写 / 读预览 / 存在性探测 / 定位文件）
 *
 * 域：fs(4)
 * 通道：fs:write / fs:read / fs:exists / fs:reveal
 *
 * ── 10-03：改为插件形态 + 接缝化（方案 §6 阶段 2/3）────────────────────────
 * 与 `remote-ipc` 同款改造，但多一步：原来直接 `import { shell } from "electron"`，
 * 现在经 `inject: ["ipc", "host"]` 取 `host.shell`。
 *
 * ⛔ **安全口径逐字保留**（这三段是 09-19 审计的高危修复，改动即安全回归）：
 *   - fs:write 忽略渲染层传入的 root（原校验可被 `root:"C:\\"` 绕过 = 任意路径写）
 *   - fs:read 收敛到可信根（原为任意路径读，XSS 即可读全盘）
 *   - fs:reveal 同样收口（防把资源管理器当探测工具）
 *   可信根判定 `isInsideTrustedRoots` 仍是**内核独占**，不经接缝（接缝可替换 = 防线可撤）。
 *
 * ⛔ `fileStat` / `sizeLabel` 来自 `./app-diagnostics`（同域族的文件 stat 与体积可读化）。
 *    ⚠️ app-diagnostics 目前仍是裸域（同批改），改它时本文件的 import 要跟着核对。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileStat, sizeLabel } from "./app-diagnostics";
import { isInsideTrustedRoots } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";

const FS_CHANNELS = ["fs:write", "fs:read", "fs:exists", "fs:reveal"];

export const fsFeature = defineFeature<null>({
  id: "fs",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    const host = ctx.get<HostCaps>("host");
    if (!ipcHost) throw new Error("fs: 缺少 ipc 服务（宿主未提供）");
    if (!host) throw new Error("fs: 缺少 host 接缝（宿主未提供）");

    ipcHost.handle("fs:write", async (_event, input: { path: string; content: string; root: string }) => {
      const resolved = path.resolve(input.path);
      // ⛔ 隐私加固（09-19 审计高危）：原校验的 root 由渲染层传入——传 root:"C:\\" 即绕过校验，
      // 等于"任意路径写文件"。root 参数不再参与判定，一律收敛到主进程自己的可信根集合
      // （各会话工作目录 + userData + 用户亲自用系统对话框选过的路径，同 harness-image 协议口径）。
      if (!isInsideTrustedRoots(resolved)) throw new Error("仅允许保存会话工作区与应用数据目录内的文件");
      await fs.writeFile(resolved, input.content, "utf8");
      return { ok: true };
    });
    // 本地读文件：预览文件内容（Base64 返回，渲染层解码）。取代转发给引擎的 fs/readFile——
    // 引擎的 fs/readFile 是给 AI 用的工具，非任务上下文会失败或返回结构不一致。
    ipcHost.handle("fs:read", async (_event, input: { path: string }) => {
      const target = path.resolve(input.path);
      // ⛔ 隐私加固（09-19 审计高危）：预览通道原来是"任意路径读"——渲染层被注入（XSS）即可
      // 读全盘文件（含系统敏感目录）。收敛到可信根：会话工作目录、userData、用户选过的路径。
      // 口径与 harness-image 协议（09-13 审计 S5）完全一致，合法预览不受影响。
      if (!isInsideTrustedRoots(target)) throw new Error("仅允许预览会话工作区与应用数据目录内的文件");
      const stat = fileStat(target);
      if (!stat || !stat.isFile()) throw new Error(`文件不存在或不可读：${input.path}`);
      const size = stat.size;
      if (size > 2 * 1024 * 1024) throw new Error(`文件过大（${sizeLabel(size)}），预览仅支持 2MB 以内`);
      const buf = await fs.readFile(target);
      return { dataBase64: buf.toString("base64"), size };
    });
    // 探测文件是否存在（InlineFileCards 用：不存在的引用文件灰显，点击不再直接报 os error 2）
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
      const target = path.resolve(input.path);
      if (!isInsideTrustedRoots(target)) throw new Error("仅允许定位会话工作区与应用数据目录内的文件");
      const stat = await fs.stat(target).catch(() => null);
      if (!stat || !stat.isFile()) throw new Error(`文件不存在：${input.path}`);
      host.shell.showItemInFolder(target);
      return { ok: true };
    });

    // 卸载即摘通道（插件容器的可逆副作用语义）
    ctx.effect(() => {
      for (const ch of FS_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
