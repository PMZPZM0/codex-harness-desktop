/**
 * cloud-token（基座层，10-19）—— 云端**代理令牌**的缓存、签发与校验。
 *
 * 为什么从 `features/cloud-models-ipc.ts` 挪出来：探活自愈（`cloud-heal.ts`）与模型同步
 * 都要用它，而**域不能 import 域**（架构规则）⇒ 下沉为基座叶子。
 *
 * ⛔ 令牌会轮换（重签 / 换绑 / 服务端清记录 / 多设备登录）：旧串留在本机会变成
 *   「界面显示已保存、请求静默 401」（10-14/10-19 两次实测）。
 * ⇒ 非强制路径**必须校验**（`verifyProxyToken`），不能只看"有没有缓存"。
 *
 * ⛔ 明文只在返回值里（本进程内）；落盘一律 safeStorage 加密。
 */
import fs from "node:fs";
import path from "node:path";
import { cloudFetch, cloudHome, decrypt, encrypt } from "./cloud-api";

function proxyTokenFile(): string {
  return path.join(cloudHome(), "proxy-token");
}

export function readProxyToken(): string {
  try {
    return decrypt(fs.readFileSync(proxyTokenFile(), "utf8").trim());
  } catch {
    return "";
  }
}

export function writeProxyToken(token: string): boolean {
  const encrypted = encrypt(token);
  if (!encrypted) return false;
  fs.mkdirSync(cloudHome(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(proxyTokenFile(), encrypted, { mode: 0o600 });
  return true;
}

/**
 * 取代理令牌：`force` 或没有缓存时向服务端签一枚新的；`force=false` 且有缓存则复用。
 * ⛔ 纯"复用"不校验 —— 调用方要校验请用 `verifyProxyToken`（或走 `syncModels` 的校验路径）。
 */
export async function issueProxyToken(force: boolean): Promise<{ ok: boolean; token: string; reused: boolean; error?: string }> {
  if (!force) {
    const cached = readProxyToken();
    if (cached) return { ok: true, token: cached, reused: true };
  }
  const res = await cloudFetch<{ ok?: boolean; token?: string; error?: string }>("/proxy/token", { method: "POST", body: {} });
  const token = String(res.data?.token || "");
  if (!res.ok || !token) return { ok: false, token: "", reused: false, error: res.error || "token-failed" };
  writeProxyToken(token);
  return { ok: true, token, reused: false };
}

/**
 * 轻量校验本机令牌在服务端是否仍有效：`GET /proxy/models`（带 Bearer）。
 * · 401/403 ⇒ 无效（轮换出环 / 账号错位 / IP 变更）；
 * · 网络异常 ⇒ **按有效处理**（不因临时断网把用户的 key 重签掉）。
 */
export async function verifyProxyToken(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await cloudFetch("/proxy/models", { token });
    return res.status !== 401 && res.status !== 403;
  } catch {
    return true;
  }
}
