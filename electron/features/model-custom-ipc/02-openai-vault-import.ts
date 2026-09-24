/**
 * model-custom-ipc 的「openai-vault-import」部分（09-22 从同目录 model-custom-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app, ipcMain, safeStorage } from "electron";
import { OPENAI_FALLBACK_MODELS, fetchOpenaiModels, openaiAuthFile, openaiFetch, openaiProxyFile, openaiVaultFile, readOpenaiAuth, resetLiveProxyCache } from "../openai-auth";
import { readOpenaiVault, writeOpenaiVault } from "./01-openai-login";
import type { OpenaiVaultAccount } from "./01-openai-login";
ipcMain.handle("openai:capture-login", async () => {
  // 登录检测到成功后调用：把 CODEX_HOME/auth.json 的 tokens 收进 vault（按 email 去重）
  const auth = await readOpenaiAuth();
  if (!auth?.loggedIn) throw new Error("尚未检测到登录成功的账号");
  const raw = JSON.parse(await fs.readFile(openaiAuthFile(), "utf8"));
  const accounts = await readOpenaiVault();
  const id = auth.email || auth.accountId || "account";
  const entry: OpenaiVaultAccount = { id, email: auth.email, tokens: raw.tokens, savedAt: Date.now() };
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx >= 0) accounts[idx] = entry; else accounts.push(entry);
  await writeOpenaiVault(accounts);
  return { id, email: auth.email, total: accounts.length };
});

export function openaiJwtClaims(idToken?: string): Record<string, any> {
  try {
    const part = String(idToken ?? "").split(".")[1];
    if (!part) return {};
    const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch { return {}; }
}

function openaiImportEntries(content: string): any[] {
  const trimmed = String(content ?? "").trim();
  if (!trimmed) return [];
  const flatten = (v: any): any[] => (Array.isArray(v) ? v.flatMap(flatten) : [v]);
  try {
    return flatten(JSON.parse(trimmed));
  } catch { /* 整体不是合法 JSON → 按行拆（NDJSON / 每行一个裸 token） */ }
  const out: any[] = [];
  for (const line of trimmed.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("{") || t.startsWith("[")) {
      try { out.push(...flatten(JSON.parse(t))); continue; } catch { /* 当作裸 token 处理 */ }
    }
    out.push(t);
  }
  return out;
}

function openaiImportPick(obj: any, paths: string[][]): string {
  for (const path of paths) {
    let cur = obj;
    for (const key of path) {
      if (cur == null || typeof cur !== "object") { cur = undefined; break; }
      cur = cur[key];
    }
    const value = typeof cur === "string" ? cur.trim() : "";
    if (value) return value;
  }
  return "";
}

ipcMain.handle("openai:import-file", async (_e, input: { contents: string[] }) => {
  const contents = Array.isArray(input?.contents) ? input.contents : [];
  if (!contents.length) throw new Error("没有可导入的文件内容");
  const accounts = await readOpenaiVault();
  const items: { index: number; name: string; id?: string; email?: string; loginable?: boolean; action: "imported" | "updated" | "failed"; message?: string }[] = [];
  let index = 0;
  for (const content of contents) {
    for (const entry of openaiImportEntries(content)) {
      index += 1;
      const name = `#${index}`;
      try {
        const raw = typeof entry === "string" ? { access_token: entry } : entry;
        if (raw == null || typeof raw !== "object") throw new Error("无法识别的条目格式");
        const tokens = {
          access_token: openaiImportPick(raw, [["tokens", "access_token"], ["tokens", "accessToken"], ["access_token"], ["accessToken"], ["token"]]),
          refresh_token: openaiImportPick(raw, [["tokens", "refresh_token"], ["tokens", "refreshToken"], ["refresh_token"], ["refreshToken"]]),
          id_token: openaiImportPick(raw, [["tokens", "id_token"], ["tokens", "idToken"], ["id_token"], ["idToken"]]),
        };
        if (!tokens.access_token) throw new Error("缺少 accessToken（无法登录）");
        const claims = openaiJwtClaims(tokens.id_token || tokens.access_token);
        const auth = claims["https://api.openai.com/auth"] ?? {};
        const email = openaiImportPick(raw, [["email"], ["user", "email"]]) || String(claims.email ?? "");
        const accountId = openaiImportPick(raw, [["chatgpt_account_id"], ["chatgptAccountId"], ["account_id"], ["accountId"], ["account", "id"], ["account", "account_id"], ["account", "chatgpt_account_id"]]) || String(auth.chatgpt_account_id ?? "");
        // JWT exp 已过期只警告不阻断：refresh_token 仍在时引擎激活后会自行刷新
        let message: string | undefined;
        if (claims.exp && Number(claims.exp) * 1000 < Date.now()) message = "token 已过期（凭 refresh_token 激活后会自动刷新）";
        const id = email || accountId || String(claims.sub ?? "") || `import-${Date.now()}-${index}`;
        const entryOut: OpenaiVaultAccount = { id, email, tokens: { ...tokens, account_id: accountId || undefined }, savedAt: Date.now() };
        const idx = accounts.findIndex((a) => a.id === id);
        if (idx >= 0) accounts[idx] = entryOut; else accounts.push(entryOut);
        // loginable = 带 id_token（写 auth.json 后引擎才认作登录态）；裸 token 只入 vault 不作为切换目标
        items.push({ index, name: email || id, id, email, loginable: Boolean(tokens.id_token), action: idx >= 0 ? "updated" : "imported", message });
      } catch (error: any) {
        items.push({ index, name, action: "failed", message: String(error.message ?? error) });
      }
    }
  }
  await writeOpenaiVault(accounts);
  return {
    total: items.length,
    imported: items.filter((i) => i.action === "imported").length,
    updated: items.filter((i) => i.action === "updated").length,
    failed: items.filter((i) => i.action === "failed").length,
    items,
  };
});
