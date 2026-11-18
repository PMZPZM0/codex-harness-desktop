/**
 * ui-kit（11-18 立）：**用户自己的组件库**。
 *
 * 由来（用户令「画布和组件库要联动」）：
 *   组件库（component-library）原来是**随包只读**的 500+ 社区组件（`catalog.gen`），
 *   画布做出来的东西无处可存 ⇒ 只能停在画布 JSON 里，下次找不到。这里补一个**用户级存储**：
 *   画布里的稿子可以「存成组件」，组件库多一栏「我的组件」，两边都走这一份数据。
 *
 * 口径：
 *   · 存 `<userData>/ui-kit.json`（⛔ 惰性求值：`app.getPath` 不能在模块体跑，守卫【91】）；
 *   · 一条 = { id, name, createdAt, doc }，doc 就是画布的 JSON（⛔ 不裁剪、不改写上游结构）；
 *   · 上限 200 条、单条 512KB（防止一个 20MB 的稿子把档案撑爆）；
 *   · ⛔ 不做"自动同步"、不做版本历史 —— 用户手动存、手动删。
 *
 * 域：ui-kit(3) —— list / save / remove。
 */
import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export type UiKitItem = {
  id: string;
  name: string;
  createdAt: number;
  /** 画布 JSON 原样保存（结构由上游 m3e-canvas 决定，这里不认识它）。 */
  doc: unknown;
};

const MAX_ITEMS = 200;
const MAX_BYTES = 512 * 1024;

const fileOf = () => path.join(app.getPath("userData"), "ui-kit.json");

async function readAll(): Promise<UiKitItem[]> {
  try {
    const list = JSON.parse(await readFile(fileOf(), "utf8")) as UiKitItem[];
    return Array.isArray(list) ? list.filter((x) => x && x.id && x.doc) : [];
  } catch {
    return [];
  }
}

async function writeAll(list: UiKitItem[]): Promise<void> {
  await mkdir(path.dirname(fileOf()), { recursive: true });
  await writeFile(fileOf(), JSON.stringify(list, null, 2), "utf8");
}

export const uiKitFeature = defineFeature<null>({
  id: "ui-kit",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("ui-kit: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("ui-kit:list", async () => {
      const list = await readAll();
      return list.map((x) => ({ id: x.id, name: x.name, createdAt: x.createdAt, bytes: JSON.stringify(x.doc).length }));
    });

    ipcHost.handle("ui-kit:get", async (_event, id: string) => {
      const list = await readAll();
      return list.find((x) => x.id === String(id)) ?? null;
    });

    /* 存一条（画布「存成组件」走这里）。同名视为同一件：覆盖而不堆重复。 */
    ipcHost.handle("ui-kit:save", async (_event, input: { name?: string; doc?: unknown }) => {
      const name = String(input?.name ?? "").trim() || `画布稿 ${new Date().toLocaleString("zh-CN")}`;
      if (!input?.doc || typeof input.doc !== "object") throw new Error("画布内容是空的，先摆几个部件再存");
      const bytes = JSON.stringify(input.doc).length;
      if (bytes > MAX_BYTES) throw new Error(`内容太大（${Math.round(bytes / 1024)}KB），上限 ${Math.round(MAX_BYTES / 1024)}KB`);
      const list = await readAll();
      const hit = list.find((x) => x.name === name);
      const item: UiKitItem = { id: hit?.id ?? `k-${Date.now().toString(36)}`, name, createdAt: Date.now(), doc: input.doc };
      const next = hit ? list.map((x) => (x.id === hit.id ? item : x)) : [item, ...list].slice(0, MAX_ITEMS);
      await writeAll(next);
      return { id: item.id, name: item.name, replaced: Boolean(hit), count: next.length };
    });

    ipcHost.handle("ui-kit:remove", async (_event, id: string) => {
      const list = await readAll();
      const next = list.filter((x) => x.id !== String(id));
      await writeAll(next);
      return { removed: list.length - next.length, count: next.length };
    });

    ctx.effect(() => {
      for (const ch of ["ui-kit:list", "ui-kit:get", "ui-kit:save", "ui-kit:remove"]) ipcHost.removeHandler(ch);
    });
  },
});
