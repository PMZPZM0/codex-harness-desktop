/**
 * 应用密码锁（10-26 用户令）：默认关闭；开启后生成随机或自定义解锁密码，
 * 密码只在设置流程里展示一次，磁盘只存 scrypt 加盐哈希。
 *
 * 安全边界（必须诚实）：
 *   · 这是**界面门禁**，不是磁盘加密。能直接读本机文件的人仍可删掉 app-lock.json 绕过；
 *     它的目标是「别人拿到正在运行的电脑时进不来」。
 *   · 失败次数落盘（重启也累计）；连续 10 次错误 → 写重置标记 → 重启后清空应用数据。
 *   · 密码明文从不落盘、不写日志、不回传第二次。
 *
 * 本模块**只做纯文件/加密逻辑**（不 import electron），便于 node --test 直接跑。
 * 应用数据重置标记由本模块维护；真正的重启与删除由主进程启动早期调用 consumeResetRequest。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const APP_LOCK_FILE = "app-lock.json";
export const RESET_MARKER_FILE = ".app-lock-reset.json";
export const MAX_ATTEMPTS = 10;
export const MIN_CUSTOM_LENGTH = 6;
export const MAX_CUSTOM_LENGTH = 64;
const SCRYPT_KEYLEN = 64;
const RESET_MARKER_MAX_AGE_MS = 10 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;

export type AppLockKind = "random" | "custom";

type LockState = {
  version: 1;
  enabled: true;
  kind: AppLockKind;
  salt: string;
  hash: string;
  attempts: number;
  createdAt: number;
  updatedAt: number;
};

export type AppLockStatus = {
  enabled: boolean;
  attempts: number;
  remaining: number;
  resetRequired: boolean;
  kind?: AppLockKind;
  createdAt?: number;
};

type PendingSetup = { id: string; kind: AppLockKind; salt: string; hash: string; createdAt: number };

/** 同时只保留一个待确认的开启流程；未确认前不落盘（应用中途退出 = 锁不会半开）。 */
let pendingSetup: PendingSetup | null = null;

export function lockFilePath(userDataDir: string): string {
  return path.join(userDataDir, APP_LOCK_FILE);
}

export function resetMarkerPath(anchorDir: string): string {
  return path.join(anchorDir, RESET_MARKER_FILE);
}

function normalizeKind(value: unknown): AppLockKind {
  return value === "random" ? "random" : "custom";
}

function normalizeAttempts(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_ATTEMPTS, Math.floor(n));
}

function readState(userDataDir: string): LockState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(lockFilePath(userDataDir), "utf8"));
    if (!raw || raw.enabled !== true || typeof raw.salt !== "string" || typeof raw.hash !== "string") return null;
    if (!raw.salt || !raw.hash) return null;
    return {
      version: 1,
      enabled: true,
      kind: normalizeKind(raw.kind),
      salt: raw.salt,
      hash: raw.hash,
      attempts: normalizeAttempts(raw.attempts),
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

function writeState(userDataDir: string, state: LockState): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  const target = lockFilePath(userDataDir);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  try { fs.chmodSync(tmp, 0o600); } catch { /* Windows 上不支持/无意义 */ }
  fs.renameSync(tmp, target);
}

/** 随机 16 位、去掉易混字符；展示时由 formatPasswordForDisplay 分组。 */
export function generateRandomPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 16; i += 1) out += alphabet[crypto.randomInt(0, alphabet.length)];
  return out;
}

export function formatPasswordForDisplay(password: string, kind: AppLockKind): string {
  if (kind !== "random") return password;
  return password.replace(/(.{4})/g, "$1 ").trim();
}

function canonicalPassword(password: string, kind: AppLockKind): string {
  const value = String(password ?? "");
  return kind === "random" ? value.replace(/[\s-]/g, "") : value.trim();
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("base64");
}

function passwordMatches(password: string, state: LockState): boolean {
  const actual = Buffer.from(hashPassword(canonicalPassword(password, state.kind), state.salt), "base64");
  const expected = Buffer.from(state.hash, "base64");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function validateCustomPassword(password: string): string | null {
  const value = String(password ?? "").trim();
  if (value.length < MIN_CUSTOM_LENGTH) return `密码至少 ${MIN_CUSTOM_LENGTH} 位`;
  if (value.length > MAX_CUSTOM_LENGTH) return `密码最多 ${MAX_CUSTOM_LENGTH} 位`;
  if (/[\u0000-\u001f\u007f]/.test(value)) return "密码不能包含换行或控制字符";
  return null;
}

export function getAppLockStatus(userDataDir: string): AppLockStatus {
  const state = readState(userDataDir);
  if (!state) return { enabled: false, attempts: 0, remaining: MAX_ATTEMPTS, resetRequired: false };
  return {
    enabled: true,
    attempts: state.attempts,
    remaining: Math.max(0, MAX_ATTEMPTS - state.attempts),
    resetRequired: state.attempts >= MAX_ATTEMPTS,
    kind: state.kind,
    createdAt: state.createdAt,
  };
}

export type PrepareResult =
  | { ok: true; setupId: string; password: string; kind: AppLockKind }
  | { ok: false; error: string };

/** 生成待确认的密码（随机或自定义），返回明文**仅此一次**；确认 enableSetup 前不落盘。 */
export function prepareAppLockSetup(userDataDir: string, input: { mode?: string; password?: string }): PrepareResult {
  if (getAppLockStatus(userDataDir).enabled) return { ok: false, error: "应用锁已经开启；如需换密码，请先关闭再重新开启" };
  const kind = input?.mode === "random" ? "random" : "custom";
  let password = "";
  if (kind === "random") {
    password = generateRandomPassword();
  } else {
    const invalid = validateCustomPassword(String(input?.password ?? ""));
    if (invalid) return { ok: false, error: invalid };
    password = String(input?.password ?? "").trim();
  }
  const salt = crypto.randomBytes(32).toString("base64");
  pendingSetup = {
    id: crypto.randomUUID(),
    kind,
    salt,
    hash: hashPassword(canonicalPassword(password, kind), salt),
    createdAt: Date.now(),
  };
  return { ok: true, setupId: pendingSetup.id, password, kind };
}

export function enableAppLockSetup(userDataDir: string, setupId: string): { ok: boolean; error?: string } {
  const pending = pendingSetup;
  if (!pending || pending.id !== String(setupId ?? "")) return { ok: false, error: "开启流程已失效，请重新生成密码" };
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
    pendingSetup = null;
    return { ok: false, error: "密码确认超时，请重新生成" };
  }
  const now = Date.now();
  writeState(userDataDir, {
    version: 1,
    enabled: true,
    kind: pending.kind,
    salt: pending.salt,
    hash: pending.hash,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  pendingSetup = null;
  return { ok: true };
}

export function cancelAppLockSetup(setupId: string): { ok: boolean } {
  if (!pendingSetup || pendingSetup.id !== String(setupId ?? "")) return { ok: false };
  pendingSetup = null;
  return { ok: true };
}

export type VerifyResult = { ok: boolean; remaining: number; reset?: boolean; error?: string };

/** 验证密码；第 10 次错误返回 reset=true（调用方负责写重置标记并重启）。 */
export function verifyAppLockPassword(userDataDir: string, password: string): VerifyResult {
  const state = readState(userDataDir);
  if (!state) return { ok: true, remaining: MAX_ATTEMPTS };
  if (state.attempts >= MAX_ATTEMPTS) return { ok: false, remaining: 0, reset: true };
  if (passwordMatches(password, state)) {
    if (state.attempts !== 0) writeState(userDataDir, { ...state, attempts: 0, updatedAt: Date.now() });
    return { ok: true, remaining: MAX_ATTEMPTS };
  }
  const attempts = Math.min(MAX_ATTEMPTS, state.attempts + 1);
  writeState(userDataDir, { ...state, attempts, updatedAt: Date.now() });
  return { ok: false, remaining: MAX_ATTEMPTS - attempts, reset: attempts >= MAX_ATTEMPTS };
}

export function disableAppLock(userDataDir: string, password: string): VerifyResult {
  const result = verifyAppLockPassword(userDataDir, password);
  if (!result.ok) return result;
  try { fs.unlinkSync(lockFilePath(userDataDir)); } catch { /* 文件不存在 = 本来就关着 */ }
  return { ok: true, remaining: MAX_ATTEMPTS };
}

/**
 * 在第 10 次错误后调用：写重置标记（不立刻删数据 —— 新进程启动早期删更干净）。
 * ⛔ 标记必须带上**目标 userData**：锚点目录是所有 profile 共用的（测试 profile / 默认 profile），
 *    只写锚点会让另一个 profile 的启动消费掉它（10-26 测试实测事故：测试锁把默认 profile 清了）。
 */
export function requestAppDataReset(anchorDir: string, userDataDir: string): string {
  fs.mkdirSync(anchorDir, { recursive: true });
  const target = resetMarkerPath(anchorDir);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ at: Date.now(), version: 1, userData: path.resolve(userDataDir) }) + "\n", "utf8");
  fs.renameSync(tmp, target);
  return target;
}

function isRootOrHome(dir: string): boolean {
  const resolved = path.resolve(dir);
  return resolved === path.parse(resolved).root || resolved === path.resolve(os.homedir());
}

function confirmedCustomDir(anchorDir: string, userDataDir: string): boolean {
  if (userDataDir === anchorDir) return true;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(anchorDir, "data-dir.json"), "utf8"));
    const configured = String(raw?.dir ?? "").trim();
    if (!configured) return false;
    return path.resolve(configured) === path.resolve(userDataDir);
  } catch {
    return false;
  }
}

function removeDirBestEffort(dir: string): void {
  if (!dir || isRootOrHome(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 120 });
    return;
  } catch { /* 被占用时继续逐项删，至少清掉能清的数据 */ }
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      try { fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true, maxRetries: 5, retryDelay: 80 }); } catch { /* 锁文件跳过 */ }
    }
  } catch { /* 目录不可读 */ }
}

/**
 * 启动早期（app.setPath 之前）调用：只认 10 分钟内写下的重置标记。
 * 同时删除当前数据目录与固定锚点目录 —— 自定义数据目录经 data-dir.json 确认过才删，
 * 避免误删用户随手选择的普通文件夹。
 */
export function consumeResetRequest(anchorDir: string, userDataDir: string): boolean {
  const marker = resetMarkerPath(anchorDir);
  let info: { at?: number; userData?: string } | null = null;
  try { info = JSON.parse(fs.readFileSync(marker, "utf8")); } catch { return false; }
  const at = Number(info?.at);
  if (!Number.isFinite(at) || Date.now() - at > RESET_MARKER_MAX_AGE_MS) {
    try { fs.unlinkSync(marker); } catch { /* 忽略 */ }
    return false;
  }
  /* 标记属于哪个 profile 就只重置哪个；跨 profile 的标记一律不消费（留在原处，等它自己的进程处理）。 */
  const targetUserData = String(info?.userData ?? "").trim();
  if (targetUserData && path.resolve(targetUserData) !== path.resolve(userDataDir)) return false;
  /* 只删「当前 profile 自己的数据」：
     · 当前就是锚点目录 → 删锚点；
     · 当前是 data-dir.json 明确指过的自定义目录 → 锚点里的指路牌与自定义目录一起删；
     · 当前是 env/其它方式指定的自定义目录（没有指路牌）→ 只删它，**绝不碰默认锚点**
       （否则测试 profile 的重置会清掉默认 profile —— 10-26 实测事故的第二种形态）。 */
  const targets = new Set<string>();
  const atAnchor = path.resolve(userDataDir) === path.resolve(anchorDir);
  if (atAnchor) {
    targets.add(anchorDir);
  } else if (confirmedCustomDir(anchorDir, userDataDir)) {
    targets.add(anchorDir);
    targets.add(userDataDir);
  } else if (userDataDir) {
    targets.add(userDataDir);
  }
  for (const dir of targets) removeDirBestEffort(dir);
  try { fs.unlinkSync(marker); } catch { /* 锚点目录可能已被整体删除；或不在 targets 里 */ }
  return true;
}
