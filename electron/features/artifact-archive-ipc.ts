/**
 * 产物归档域 IPC（11-11 独立板块）—— 只暴露一条只读清单通道给新设置页。
 *
 * ⛔ 归档动作**不走 IPC**：模型经 harness_tools 网关调 artifact_archive（执行端在
 *   `features/artifact-archive.ts` 的 runArtifactTool）；界面只读、不写，避免两条写入链。
 * ⛔ 用 defineFeature 注册（与 media-desk 同构），由 `npm run gen:domains` 登记进 composition.gen.ts。
 */
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { artifactsRoot, listArchives } from "./artifact-archive";
import path from "node:path";

const CHANNELS = ["artifact:list"] as const;

export const artifactArchiveFeature = defineFeature<null>({
  id: "artifact",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("artifact-archive: 缺少 ipc 服务（宿主未提供）");
    ipcHost.handle("artifact:list", (_event, workspace?: string) => {
      const ws = String(workspace ?? "").trim();
      if (!ws) return { ok: false, rows: [], error: "先打开一个项目 —— 产物跟着工作区走" };
      try {
        const root = artifactsRoot(ws);
        /* 绝对路径由主进程给（⛔ 前端不拼路径，Windows 分隔符容易错）。 */
        return { ok: true, rows: listArchives(ws, 60).map((r) => ({ ...r, path: path.join(root, r.dir) })) };
      } catch (e) {
        return { ok: false, rows: [], error: `读取产物清单失败：${String((e as Error)?.message ?? e)}` };
      }
    });
    ctx.effect(() => {
      for (const channel of CHANNELS) ipcHost.removeHandler(channel);
    });
  },
});
