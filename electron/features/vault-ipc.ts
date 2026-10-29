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
import { clipboard } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";

import type { VaultItem } from "../../src/lib/rail-ipc-types";
export type { VaultItem };

type StoredItem = Omit<VaultItem, "hasSecret"> & { secret?: string };

const vaultFile = (userData: string) => path.join(userData, "vault.json");

async function readAll(userData: string): Promise<StoredItem[]> {
  try {
    const raw = JSON.parse(await fs.readFile(vaultFile(userData), "utf8"));
    return Array.isArray(raw?.items) ? raw.items : [];
  } catch {
    return [];
  }
}

async function writeAll(userData: string, items: StoredItem[]): Promise<void> {
  const file = vaultFile(userData);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify({ version: 1, items }, null, 2), { mode: 0o600 });
}

const toPublic = (item: StoredItem): VaultItem => {
  const { secret, ...rest } = item;
  return { ...rest, hasSecret: Boolean(secret) };
};

const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const newId = () => `pw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/* ── 可复用入口（10-29）：模型侧工具（data-access）与 IPC 共用同一套读写/复制逻辑。
   ⛔ 模型侧只允许「存在性查询 / 复制到剪贴板」，**永不返回明文** —— 所以这里所有导出的
      返回值类型里都没有 secret 字段，只有 `hasSecret`（类型层面就堵死，不靠调用方自觉）。 */
type Secure = HostCaps["secure"];

export async function listVault(userData: string, secure: Secure): Promise<{ items: VaultItem[]; encrypted: boolean }> {
  const items = await readAll(userData);
  return { items: items.map(toPublic), encrypted: secure.isEncryptionAvailable() };
}

/** 存在性查询：按标题/用户名/网址模糊匹配，只回公开字段。 */
export async function findVaultItems(userData: string, query: unknown): Promise<VaultItem[]> {
  const needle = String(query ?? "").trim().toLowerCase();
  const items = (await readAll(userData)).map(toPublic);
  if (!needle) return items;
  return items.filter((item) =>
    [item.title, item.username, item.url, item.note].some((field) => String(field ?? "").toLowerCase().includes(needle)),
  );
}

/** 解密后直接写系统剪贴板；明文只在主进程内存里存在一瞬，**返回体里没有明文**。 */
export async function copyVaultSecret(userData: string, secure: Secure, id: string): Promise<{ ok: boolean; reason?: string; title?: string }> {
  const item = (await readAll(userData)).find((entry) => entry.id === String(id ?? ""));
  if (!item?.secret) return { ok: false, reason: "这条没有保存密码" };
  if (!secure.isEncryptionAvailable()) return { ok: false, reason: "本机加密不可用，无法解密" };
  let plain = "";
  try {
    plain = secure.decryptString(Buffer.from(item.secret, "base64"));
  } catch {
    return { ok: false, reason: "解密失败（可能换了系统账户或数据被改过）" };
  }
  clipboard.writeText(plain);
  /* 30s 后若剪贴板仍是这串密码就清掉；用户中途复制了别的东西则不动。 */
  setTimeout(() => {
    try {
      void Promise.resolve(clipboard.readText()).then((current) => {
        if (current === plain) clipboard.clear();
      }).catch(() => undefined);
    } catch { /* 剪贴板被占用等情况忽略 */ }
  }, 30_000);
  return { ok: true, title: item.title };
}

/** 保存/更新：password 省略 ⇒ 保留原密码。加密不可用时拒绝写入（不落明文）。 */
export async function saveVaultItem(userData: string, secure: Secure, input: Record<string, unknown>): Promise<{ items: VaultItem[] }> {
  const items = await readAll(userData);
  const id = clean(input.id, 80);
  const password = typeof input.password === "string" ? input.password : undefined;
  if (password && !secure.isEncryptionAvailable()) {
    throw new Error("本机加密不可用，无法安全保存密码（没有写入任何明文）");
  }
  const secret = password ? secure.encryptString(password).toString("base64") : undefined;
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
  await writeAll(userData, items);
  return { items: items.map(toPublic) };
}

export const vaultFeature = defineFeature<null>({
  id: "vault",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    const host = ctx.get<HostCaps>("host");
    if (!ipcHost) throw new Error("vault: 缺少 ipc 服务（宿主未提供）");
    if (!host) throw new Error("vault: 缺少 host 接缝（宿主未提供）");
    /* 路径与加解密一律走接缝（用户数据目录只在 setPath 之后才准求值；safeStorage 是密钥库，域不许直取）。 */
    const userData = () => host.app.getPath("userData");
    const secure = host.secure;

    ipcHost.handle("vault:list", async (): Promise<{ items: VaultItem[]; encrypted: boolean }> =>
      listVault(userData(), secure));

    /** 保存：password 省略/空 ⇒ 保留原密码（编辑时不必重输）。 */
    /** 保存：password 省略/空 ⇒ 保留原密码（编辑时不必重输）。逻辑在 saveVaultItem（与模型侧工具共用）。 */
    ipcHost.handle("vault:save", async (_event, input: Record<string, unknown>): Promise<{ items: VaultItem[] }> =>
      saveVaultItem(userData(), secure, input));

    ipcHost.handle("vault:remove", async (_event, id: string): Promise<{ items: VaultItem[] }> => {
      const items = (await readAll(userData())).filter((item) => item.id !== String(id ?? ""));
      await writeAll(userData(), items);
      return { items: items.map(toPublic) };
    });

    /** 复制到剪贴板：明文只在主进程内存里出现一瞬，渲染层拿不到。逻辑在 copyVaultSecret。 */
    ipcHost.handle("vault:copy", async (_event, id: string): Promise<{ ok: boolean; reason?: string }> => {
      const result = await copyVaultSecret(userData(), secure, id);
      return result.ok ? { ok: true } : { ok: false, reason: result.reason };
    });

    ctx.effect(() => {
      for (const ch of ["vault:list", "vault:save", "vault:remove", "vault:copy"]) ipcHost.removeHandler(ch);
    });
  },
});
