/**
 * extensions-ipc（10-27）：**输入框竖条**与**功能入口菜单**的可扩展目录。
 *
 * 用户令：「这个小粗条弹窗记得留好IPC接口，还有那个功能入口菜单也留好IPC接口，
 * 方便后续拓展和用户拓展」。
 *
 * 做法：两处入口都**不在组件里写死**，而是由这里的目录驱动：
 *   · 内置项写在本文件（rail 四个面板 / 菜单项只做占位，菜单本体仍由渲染层的
 *     function-menu 模型管排序与折叠）；
 *   · 用户/插件扩展项来自 `userData/extensions.json`（`{ rail?: [...], menu?: [...] }`），
 *     不改代码就能多一个入口。
 *
 * ⛔ 安全边界（别放宽）：扩展项只能声明**封闭动作集** ——
 *    `url`（只 http/https）· `settings`（跳到某个设置页）· `text`（只做说明面板）。
 *    ⛔ 不提供「执行命令 / 运行脚本」动作 —— 一个 JSON 就能跑任意命令等于后门。
 *
 * 通道：extensions:catalog
 */
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export type ExternalAction =
  | { type: "url"; target: string }
  | { type: "settings"; target: string }
  | { type: "text"; body: string };

export type RailPanelSpec = {
  id: string;
  label: string;
  /** 图标名（渲染层映射到 lucide 图标；认不出就用默认图标） */
  icon?: string;
  /** builtin = 应用自带面板；external = 用户扩展（按 action 渲染） */
  kind: "builtin" | "external";
  action?: ExternalAction;
  order?: number;
};

export type MenuEntrySpec = {
  id: string;
  label: string;
  icon?: string;
  action: ExternalAction;
  order?: number;
};

const BUILTIN_RAIL: RailPanelSpec[] = [
  { id: "favorites", label: "收藏夹", icon: "bookmark", kind: "builtin", order: 10 },
  { id: "passwords", label: "密码本", icon: "key", kind: "builtin", order: 20 },
  { id: "journal", label: "开发日记", icon: "notebook", kind: "builtin", order: 30 },
  { id: "stickers", label: "心情表情", icon: "smile", kind: "builtin", order: 40 },
];

const file = () => path.join(app.getPath("userData"), "extensions.json");

/** 只认封闭动作集 + http(s) 网址；认不出的整条丢掉（不猜、不半信半疑地执行）。 */
function normalizeAction(raw: unknown): ExternalAction | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const type = String(input.type ?? "").trim();
  const target = String(input.target ?? "").trim();
  if (type === "url") return /^https?:\/\//i.test(target) ? { type: "url", target } : null;
  if (type === "settings") return target ? { type: "settings", target } : null;
  if (type === "text") return target ? { type: "text", body: target } : null;
  return null;
}

async function readUserExtensions(): Promise<{ rail: RailPanelSpec[]; menu: MenuEntrySpec[] }> {
  let raw: any = null;
  try { raw = JSON.parse(await fs.readFile(file(), "utf8")); } catch { return { rail: [], menu: [] }; }
  const rail: RailPanelSpec[] = [];
  for (const entry of Array.isArray(raw?.rail) ? raw.rail : []) {
    const id = String(entry?.id ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
    const label = String(entry?.label ?? "").trim().slice(0, 40);
    const action = normalizeAction(entry?.action);
    if (!id || !label || !action) continue;
    rail.push({ id: `ext_${id}`, label, icon: String(entry?.icon ?? "").trim().slice(0, 30) || undefined, kind: "external", action, order: Number(entry?.order) || 90 });
  }
  const menu: MenuEntrySpec[] = [];
  for (const entry of Array.isArray(raw?.menu) ? raw.menu : []) {
    const id = String(entry?.id ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
    const label = String(entry?.label ?? "").trim().slice(0, 40);
    const action = normalizeAction(entry?.action);
    if (!id || !label || !action) continue;
    /* 菜单项只开放 url 动作：设置页跳转由竖条面板负责，避免两个入口对同一动作有不同行为 */
    if (action.type !== "url") continue;
    menu.push({ id: `ext_${id}`, label, icon: String(entry?.icon ?? "").trim().slice(0, 30) || undefined, action, order: Number(entry?.order) || 90 });
  }
  return { rail, menu };
}

export const extensionsFeature = defineFeature<null>({
  id: "extensions",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("extensions: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("extensions:catalog", async (): Promise<{ rail: RailPanelSpec[]; menu: MenuEntrySpec[]; file: string }> => {
      const user = await readUserExtensions();
      const rail = [...BUILTIN_RAIL, ...user.rail].sort((a, b) => (a.order ?? 90) - (b.order ?? 90));
      const menu = [...user.menu].sort((a, b) => (a.order ?? 90) - (b.order ?? 90));
      return { rail, menu, file: file() };
    });

    ctx.effect(() => { ipcHost.removeHandler("extensions:catalog"); });
  },
});
