/**
 * vault-ipc（10-27）：本机**密码本**。
 *
 * 用户：「第二个密码本，专门给用户记密码的，密码本弹窗界面做好看一点，功能配套齐全」。
 *
 * 安全模型（定死，别改松）：
 *  · 密码用 Electron `safeStorage` 加密后落 `userData/vault.json`（base64），**明文永不落盘**；
 *  · 渲染层**永远拿不到明文** —— list/read 返回的条目里没有 password 字段，
 *    只有 `hasSecret`；需要用时走 `vault:copy`：主进程解密后直接写系统剪贴板；
 *  · 加密能力不可用时**拒绝保存密码**（与 cloud-api 同一口径：宁愿报错，也不写明文）；
 *  · 文件权限 0600、目录 0700；不写日志、不进 AGENTS.md、不参与任何云端同步。
 *
 * 通道：vault:list / vault:save / vault:remove / vault:copy
 */
import { app, clipboard, safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

import type { VaultItem } from "../../src/lib/rail-ipc-types";
export type { VaultItem };

type StoredItem = Omit<VaultItem, "hasSecret"> & { secret?: string };

const vaultFile = () => path.join(app.getPath("userData"), "vault.json");

async function readAll(): Promise<StoredItem[]> {
  try {
    const raw = JSON.parse(await fs.readFile(vaultFile(), "utf8"));
    return Array.isArray(raw?.items) ? raw.items : [];
  } catch {
    return [];
  }
}

async function writeAll(items: StoredItem[]): Promise<void> {
  const file = vaultFile();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify({ version: 1, items }, null, 2), { mode: 0o600 });
}

const toPublic = (item: StoredItem): VaultItem => {
  const { secret, ...rest } = item;
  return { ...rest, hasSecret: Boolean(secret) };
};

const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const newId = () => `pw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const vaultFeature = defineFeature<null>({
  id: "vault",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("vault: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("vault:list", async (): Promise<{ items: VaultItem[]; encrypted: boolean }> => {
      const items = await readAll();
      return { items: items.map(toPublic), encrypted: safeStorage.isEncryptionAvailable() };
    });

    /** 保存：password 省略/空 ⇒ 保留原密码（编辑时不必重输）。 */
    ipcHost.handle("vault:save", async (_event, input: Record<string, unknown>): Promise<{ items: VaultItem[] }> => {
      const items = await readAll();
      const id = clean(input.id, 80);
      const password = typeof input.password === "string" ? input.password : undefined;
      if (password && !safeStorage.isEncryptionAvailable()) {
        throw new Error("本机加密不可用，无法安全保存密码（没有写入任何明文）");
      }
      const secret = password ? safeStorage.encryptString(password).toString("base64") : undefined;
      const now = new Date().toISOString();
      const patch = {
        title: clean(input.title, 120) || "未命名",
        username: clean(input.username, 200),
        url: clean(input.url, 400),
        note: clean(input.note, 2000),
        updatedAt: now,
      };
      const at = id ? items.findIndex((item) => item.id === id) : -1;
      if (at >= 0) {
        items[at] = { ...items[at], ...patch, ...(secret ? { secret } : {}) };
      } else {
        items.unshift({ id: newId(), ...patch, ...(secret ? { secret } : {}) });
      }
      await writeAll(items);
      return { items: items.map(toPublic) };
    });

    ipcHost.handle("vault:remove", async (_event, id: string): Promise<{ items: VaultItem[] }> => {
      const items = (await readAll()).filter((item) => item.id !== String(id ?? ""));
      await writeAll(items);
      return { items: items.map(toPublic) };
    });

    /** 复制到剪贴板：明文只在主进程内存里出现一瞬，渲染层拿不到。 */
    ipcHost.handle("vault:copy", async (_event, id: string): Promise<{ ok: boolean; reason?: string }> => {
      const item = (await readAll()).find((entry) => entry.id === String(id ?? ""));
      if (!item?.secret) return { ok: false, reason: "这条没有保存密码" };
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, reason: "本机加密不可用，无法解密" };
      let plain = "";
      try {
        plain = safeStorage.decryptString(Buffer.from(item.secret, "base64"));
      } catch {
        return { ok: false, reason: "解密失败（可能换了系统账户或数据被改过）" };
      }
      clipboard.writeText(plain);
      /* 10-27 审查（界面承诺了「30 秒内粘贴」却没实现）：30s 后若剪贴板仍是这串密码就清掉；
         用户中途复制了别的东西则不动（别把人家刚复制的内容抹了）。 */
      setTimeout(() => {
        try {
          /* 兼容两种声明（同步 string / 异步 Promise<string>）：统一 Promise.resolve 后再比 */
          void Promise.resolve(clipboard.readText()).then((current) => {
            if (current === plain) clipboard.clear();
          }).catch(() => undefined);
        } catch { /* 剪贴板被占用等情况忽略 */ }
      }, 30_000);
      return { ok: true };
    });

    ctx.effect(() => {
      for (const ch of ["vault:list", "vault:save", "vault:remove", "vault:copy"]) ipcHost.removeHandler(ch);
    });
  },
});
