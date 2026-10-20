/**
 * 云端记忆「开通 / 生效」状态（10-20）。
 *
 * ⛔⛔ 为什么要有这个模块：`memoryBackend === "cloud"` 只是**用户的选择**，不等于云端记忆真的能用。
 *   服务端在权益未开通时**不建记忆空间、不发 userKey**（`/integrations` 的
 *   `memory = { ok:false, error:"not-activated" }`），此时：
 *     · 对话上游仍停在纯模型端点 ⇒ 记忆既不注入也不回写；
 *     · 但旧实现把 `effective` 直接判成 cloud ⇒ 提示层教模型「云端会自动收走」，
 *       模型什么都不做，用户以为存上了 —— 这是**静默丢记忆**，比报错更糟。
 *   ⇒ 判定必须区分两件事，且都以**服务端回执**为准：
 *     · entitled（已开通）= 服务端下发了 userKey；
 *     · applied（已生效）= 记忆上游意图已落盘（cloud-provider 的 `memory-upstream.json`）。
 *
 * 两份状态文件（⛔ 路径只在本模块与 cloud-provider 之间共享，别处别自己拼）：
 *   · `memory-activation.json` —— 本模块写，**给人看的**开通结论 + 原因（未登录 / 未开通 / 已开通）
 *   · `memory-upstream.json`   —— `cloud-provider.ts` 写，**给路由用的**生效意图（真凭据）
 *   读取侧：本模块提供同步读（`memory-backend.effectiveMemoryBackend()` 在热路径上要便宜）；
 *   cloud-provider 用异步读同一份文件 —— 两边读的是同一个文件，不是两套真相。
 *
 * ⛔ 无快照时（旧版本升级上来）**回落到意图文件**判定，避免「明明早就开通了却被判成未开通」
 *   （升级当天把用户云端记忆打回本地的回退事故）。
 */
import fs from "node:fs";
import path from "node:path";
import { cloudHome } from "./cloud-api";

/** 未开通的原因（直接决定界面文案与引导动作）。 */
export type CloudMemoryReason =
  | ""                  // 正常（已开通且已生效）
  | "not-logged-in"     // 没登录云账号 —— 引导去登录
  | "not-activated"     // 已登录但账号未开通记忆权益 —— 引导去开通
  | "no-credentials"    // 服务端说开通了，但没下发 userKey（异常/缓存脏）
  | "storage-unavailable" // 钥匙串不可用，凭据存不下（宁可不存也不写明文）
  | "unreachable"       // 连不上账号服务，无法确认
  | "account-changed";  // 换账号后尚未确认

export type CloudMemoryActivation = {
  /** active = 已开通；inactive = 明确不可用；unknown = 有登录但还没跟服务端确认过 */
  state: "active" | "inactive" | "unknown";
  reason: CloudMemoryReason;
  /** 服务端说开通了（下发了 userKey） */
  entitled: boolean;
  /** 记忆上游意图已落盘 ⇒ 对话真的会带记忆 */
  applied: boolean;
  /** 上次确认时间（0 = 从未确认） */
  checkedAt: number;
};

type Snapshot = {
  state: "active" | "inactive";
  reason: CloudMemoryReason;
  /** 服务端分发的模式：mcp（将来给 mcpUrl 时）/ rest-only（当前唯一可用形态） */
  mode?: "mcp" | "rest-only";
  checkedAt: number;
};

function snapshotFile(): string {
  return path.join(cloudHome(), "memory-activation.json");
}

/** 生效意图文件 —— 由 cloud-provider 写（⛔ 本模块只读，不写）。 */
function upstreamFile(): string {
  return path.join(cloudHome(), "memory-upstream.json");
}

function readJson<T>(file: string): T | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as T;
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

/** 记忆上游是否已落盘（同步、便宜；热路径每回合都会问）。 */
export function cloudMemoryAppliedSync(): boolean {
  const raw = readJson<{ baseUrl?: string; encryptedUserKey?: string }>(upstreamFile());
  return Boolean(raw && raw.baseUrl && raw.encryptedUserKey);
}

function readSnapshot(): Snapshot | null {
  const raw = readJson<Snapshot>(snapshotFile());
  if (!raw || (raw.state !== "active" && raw.state !== "inactive")) return null;
  return {
    state: raw.state,
    reason: (raw.reason || "") as CloudMemoryReason,
    mode: raw.mode === "mcp" ? "mcp" : "rest-only",
    checkedAt: Number(raw.checkedAt || 0),
  };
}

/**
 * 当前开通状态（同步）。**唯一读取入口** —— 界面、提示层、路由都从这里取。
 * ⛔ 无快照时按意图文件回落（升级兼容），并标成 `checkedAt = 0`（= 还没跟服务端确认过）。
 */
export function readCloudMemoryActivation(): CloudMemoryActivation {
  const applied = cloudMemoryAppliedSync();
  const snap = readSnapshot();
  if (!snap) {
    /* 没有确认记录：有意图文件 ⇒ 曾经确认成功过（旧版本升级上来），算已开通；
       否则 unknown —— 不能凭空断言"未开通"，界面要引导用户确认一次。 */
    return applied
      ? { state: "active", reason: "", entitled: true, applied: true, checkedAt: 0 }
      : { state: "unknown", reason: "", entitled: false, applied: false, checkedAt: 0 };
  }
  const entitled = snap.state === "active";
  return {
    state: snap.state,
    reason: snap.reason,
    entitled,
    /* ⛔ entitled 但意图没落盘 = 开通了还没接通（比如钥匙串不可用）⇒ 仍然不算生效。 */
    applied: entitled && applied,
    checkedAt: snap.checkedAt,
  };
}

/** 云端记忆当前**能不能真的用**（路由层只认这个，⛔ 不认用户的选择值）。 */
export function cloudMemoryUsable(): boolean {
  const act = readCloudMemoryActivation();
  return act.entitled && act.applied;
}

/** 记下一次确认结论（只由 cloud-memory 域与 cloud-provider 调用）。 */
export function writeCloudMemoryActivation(input: {
  entitled: boolean;
  reason?: CloudMemoryReason;
  mode?: "mcp" | "rest-only";
}): void {
  const snap: Snapshot = {
    state: input.entitled ? "active" : "inactive",
    reason: (input.reason || "") as CloudMemoryReason,
    mode: input.mode === "mcp" ? "mcp" : "rest-only",
    checkedAt: Date.now(),
  };
  try {
    fs.mkdirSync(cloudHome(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(snapshotFile(), JSON.stringify(snap, null, 2), { mode: 0o600 });
  } catch (error) {
    /* 写不下不影响本次判定（内存里的调用方已经知道结论）—— 但不能静默当成成功。 */
    console.warn("[cloud-memory] 开通状态快照写入失败：", error instanceof Error ? error.message : String(error));
  }
}

/**
 * 换账号 / 登出时把确认结论重置为「待确认」。
 * ⛔ 必须**写一条 inactive 快照**而不是删文件：删掉会走到「无快照 ⇒ 按意图文件回落到已开通」
 *   的升级兼容分支，等于换账号后仍然冒充已开通（新账号未必有权益）。
 * ⛔ 不清 `memory-upstream.json`：那是 cloud-provider 的职责（它会 setMemoryUpstream(null)）。
 */
export function clearCloudMemoryActivation(reason: CloudMemoryReason = "account-changed"): void {
  writeCloudMemoryActivation({ entitled: false, reason });
}

/** 原因 → 给用户看的一句话（⛔ 界面文案的唯一来源，别在组件里再写一份 if）。 */
export function describeCloudMemoryReason(reason: CloudMemoryReason): string {
  switch (reason) {
    case "not-logged-in": return "尚未登录云账号";
    case "not-activated": return "当前账号未开通云端记忆";
    case "no-credentials": return "服务端未下发记忆凭据（权益异常）";
    case "storage-unavailable": return "系统钥匙串不可用，记忆凭据无法安全保存";
    case "unreachable": return "连不上账号服务，无法确认开通状态";
    case "account-changed": return "刚切换过账号，需要重新确认";
    default: return "尚未确认开通状态";
  }
}
