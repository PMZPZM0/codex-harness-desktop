/**
 * pasted-text-ipc（10-03 从 `features/settings-app-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：pasted-text(3)
 * 通道：pasted-text:save / pasted-text:read / pasted-text:update
 *
 * ⛔⛔ 路径收敛（`isInsidePastedTextDir`）：只允许读写**应用自己保存**的粘贴文本目录，
 *    渲染层传来的路径不可信 —— 去掉这层校验就等于任意文件读/写（09-19 审计同型）。
 * ⛔ 文件名带内容提示（首行去非法字符，截 16 字）+ sha1 前 8 位，让 chip 一眼认得出内容。
 * ⛔ 待接缝化（阶段 2）：fs 为宿主能力。
 */
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { fileStat } from "./app-diagnostics";
import { pastedTextDir } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

function isInsidePastedTextDir(target: string) {
  const resolved = path.resolve(target);
  const relative = path.relative(pastedTextDir, resolved);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export const pastedTextFeature = defineFeature<null>({
  id: "pasted-text",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("pasted-text: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("pasted-text:save", async (_event, text: unknown) => {
      const content = typeof text === "string" ? text : "";
      if (!content.trim()) return null;
      await fs.mkdir(pastedTextDir, { recursive: true });
      const hash = crypto.createHash("sha1").update(content, "utf8").digest("hex").slice(0, 8);
      // 名字里带一段"内容提示"（首行去掉不适合做文件名的字符），让 chip 一眼能认出来是什么
      const hint = content.trim().split(/\r?\n/, 1)[0]
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
        .trim()
        .slice(0, 16) || "文本";
      const file = path.join(pastedTextDir, `粘贴文本-${hint}-${hash}.txt`);
      if (!fileStat(file)) await fs.writeFile(file, content, "utf8");
      return file;
    });
    ipcHost.handle("pasted-text:read", async (_event, target: unknown) => {
      const file = typeof target === "string" ? target : "";
      if (!file || !isInsidePastedTextDir(file)) return { editable: false };
      if (!fileStat(file)) return { editable: true, content: null };
      return { editable: true, content: await fs.readFile(path.resolve(file), "utf8") };
    });
    ipcHost.handle("pasted-text:update", async (_event, input: { path: string; content: string }) => {
      const file = typeof input?.path === "string" ? input.path : "";
      if (!file || !isInsidePastedTextDir(file)) throw new Error("只允许编辑应用自己保存的粘贴文本");
      await fs.mkdir(pastedTextDir, { recursive: true });
      await fs.writeFile(path.resolve(file), String(input?.content ?? ""), "utf8");
      return { ok: true, size: Buffer.byteLength(String(input?.content ?? ""), "utf8") };
    });

    ctx.effect(() => {
      for (const ch of ["pasted-text:save", "pasted-text:read", "pasted-text:update"]) ipcHost.removeHandler(ch);
    });
  },
});
