/**
 * openai-vault（10-03 从 `features/model-custom-ipc/01-openai-login.ts` + `02-...` **下沉到基座层**）
 *
 * 为什么下沉：`readOpenaiVault` / `writeOpenaiVault` / `openaiJwtClaims` 同时被 **openai 域**
 * （accounts / capture-login / import-file）与 **custom-model 域**（set-enabled 的账号正反联动）使用。
 * 按前缀拆成两个板块后，它们不能留在任一域的内部文件里 ⇒ 下沉到基座层（判据：不注册通道、
 * 只提供能力 ⇒ `ARCHITECTURE-RULES.md` §1.1 的基座层）。
 */
import fs from "node:fs/promises";
import { openaiVaultFile } from "./features/openai-auth";

export type OpenaiVaultAccount = {
  id: string;
  email: string;
  tokens: { id_token?: string; access_token?: string; refresh_token?: string; account_id?: string };
  savedAt: number;
};

export async function readOpenaiVault(): Promise<OpenaiVaultAccount[]> {
  try {
    const vault = JSON.parse(await fs.readFile(openaiVaultFile(), "utf8"));
    return Array.isArray(vault?.accounts) ? vault.accounts : [];
  } catch { return []; }
}

export async function writeOpenaiVault(accounts: OpenaiVaultAccount[]) {
  await fs.writeFile(openaiVaultFile(), JSON.stringify({ accounts }, null, 2), "utf8");
}

export function openaiJwtClaims(idToken?: string): Record<string, any> {
  try {
    const part = String(idToken ?? "").split(".")[1];
    if (!part) return {};
    const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch { return {}; }
}
