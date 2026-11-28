/**
 * 含凭据的小状态文件读写（11-28 安全审计 F-04）。
 *
 * 背景：六类 IM 网关（飞书 / Telegram / QQ / 钉钉 / 企微 webhook / 微信）各自把 appSecret、bot token、
 * clientSecret、webhook URL 直接 JSON.stringify 明文写进 userData —— 而同仓 channel-bot / 连接器 /
 * 云账号 / 密码本都走 safeStorage。口径分裂，属**意外泄露**（不是用户要求的取舍）。
 *
 * 设计：
 *  · 有系统密钥库（safeStorage.isEncryptionAvailable）⇒ 密文 + `enc:v1:` 前缀 + base64；
 *  · 没有（便携模式 / 无 DPAPI）⇒ 退回明文，并 warn 一次 —— 与旧行为完全一致，不阻塞连接；
 *  · 读侧靠前缀区分：旧明文文件照常读，**下一次写入自动变密文**（无需单独迁移脚本）。
 * ⛔ 只用于"小、整体读写"的状态文件；不要把大文件或频繁写的东西挂上来。
 */
import fs from "node:fs";
import { safeStorage } from "electron";

const PREFIX = "enc:v1:";
let warnedPlain = false;

/**
 * safeStorage 是否真的可用。
 * ⛔⛔ 必须 try/catch：在非 Electron 进程（守卫的 stub 环境）或密钥库未初始化时，
 * `safeStorage.isEncryptionAvailable()` 会直接抛 —— 不接住的话写入整条失败，
 * 凭据根本不落盘（重启就要重连），而调用方是 `catch { 持久化失败不阻塞 }`，
 * 症状会表现成「连上了但重启丢账号」，极难定位。
 */
function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/** 写一份含凭据的状态文件（加密优先；不可用时明文以便功能不中断）。 */
export function writeSecretJson(file: string, data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  if (canEncrypt()) {
    try {
      fs.writeFileSync(file, PREFIX + safeStorage.encryptString(json).toString("base64"), "utf8");
      return;
    } catch {
      /* 加密写失败 ⇒ 退回明文，别让账号丢失 */
    }
  }
  if (!warnedPlain) {
    warnedPlain = true;
    console.warn("[secure-state] 系统密钥库不可用：含凭据的状态文件只能明文落盘（下次可用时会自动加密）");
  }
  fs.writeFileSync(file, json, "utf8");
}

/** 读上面写的文件；兼容旧明文；解析失败返回 null（调用方按「未配置」处理）。 */
export function readSecretJson<T = any>(file: string): T | null {
  let raw = "";
  try { raw = fs.readFileSync(file, "utf8"); } catch { return null; }
  if (raw.startsWith(PREFIX)) {
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(raw.slice(PREFIX.length), "base64"))) as T;
    } catch {
      /* 密文解不开（换了机器 / 密钥库重置）⇒ 当未配置，让用户重连一次即可 */
      return null;
    }
  }
  try { return JSON.parse(raw) as T; } catch { return null; }
}
