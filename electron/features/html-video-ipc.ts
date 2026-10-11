/**
 * html-video-ipc（P1，2026-10-11）—— 本地 HTML/CSS 动画 → MP4。
 *
 * 域：html-video(1)
 * 通道：html-video:render
 *
 * ⛔ 输入输出都过闸：`source` 由引擎模块校验（http(s) 或可信根内 .html）；
 *    `outPath` 这里再挡一道 —— 只许写进可信根（会话工作目录 / 应用数据目录），
 *    不传就落到 `<userData>/renders/`。
 */
import path from "node:path";
import { app } from "electron";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { renderHtmlToVideo } from "../html-video";
import { isInsideTrustedRoots } from "../runtime-refs";

export const htmlVideoFeature = defineFeature<null>({
  id: "html-video",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("html-video: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("html-video:render", async (_event, input: {
      source?: string; seconds?: number; fps?: number; width?: number; height?: number; outPath?: string;
    }) => {
      const wanted = String(input?.outPath ?? "").trim();
      let outPath = "";
      if (wanted) {
        const abs = path.resolve(wanted);
        if (!isInsideTrustedRoots(abs)) return { ok: false, error: "输出路径不在可信目录内（会话工作目录 / 应用数据目录）" };
        outPath = abs.endsWith(".mp4") ? abs : `${abs}.mp4`;
      } else {
        outPath = path.join(app.getPath("userData"), "renders", `html-video-${Date.now()}.mp4`);
      }
      return renderHtmlToVideo({
        source: String(input?.source ?? ""),
        outPath,
        seconds: Number(input?.seconds ?? 3),
        fps: Number(input?.fps ?? 30),
        width: Number(input?.width ?? 1280),
        height: Number(input?.height ?? 720),
      });
    });

    ctx.effect(() => {
      ipcHost.removeHandler("html-video:render");
    });
  },
});
