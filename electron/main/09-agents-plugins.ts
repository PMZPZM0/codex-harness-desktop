/**
 * main 的「agents-plugins」部分（09-22 从同目录 main.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import fs from "node:fs/promises";
import { safeStorage } from "electron";
import { builtinPluginsFile, subAgentsFile } from "../runtime-paths";

/** 内置插件的一段配置（生图）—— **内存态**：`apiKey` 是解出来的明文。 */
export type BuiltinPluginEntry = { enabled?: boolean; baseUrl: string; apiKey: string; model: string };
/** 内存态配置（消费方只认这个形状：apiKey 是明文，用完即弃）。
 *  ⛔ 10-30 撤 `vision` 段：视觉辅助插件整体移除；存量 builtin-plugins.json 里的 vision 段
 *    读取时直接忽略，下一次保存即被清出文件。 */
export type BuiltinPluginConfig = { image?: BuiltinPluginEntry };
/** 落盘态：密钥**只**以 `encryptedKey`（safeStorage/DPAPI 密文的 base64）存在；`apiKey` 仅为兼容存量文件。 */
type StoredPluginEntry = Omit<BuiltinPluginEntry, "apiKey"> & { apiKey?: string; encryptedKey?: string };

/**
 * ⛔⛔ **内置插件的密钥一律加密落盘（10-13 体检 P0-1）**。
 *
 * 起因：`builtin-plugins.json` 过去把生图/视觉的 `apiKey` **明文**写进用户数据目录 ——
 * 任何进程、截图、目录列表、备份都能直接读到；而**同一个应用**的 `custom-models.json`
 * 早就走 `safeStorage` 加密（`encryptedKey`）。同一条链路两套口径，这条没跟上。
 * 现在统一：**落盘只有密文**，明文只存在于内存（用完即弃）。
 *
 * ⛔ 读取必须**容忍存量明文**：老用户的文件里就是 `apiKey`，而 `scripts/verify-image-plugin.mjs`
 *   的端到端夹具也直接写明文（那是既有判据，不能为了本改动把它打红）。
 *   ⇒ 有 `encryptedKey` 就解密用它；没有就原样返回 `apiKey`（升级由 `migrateBuiltinPluginSecrets` 做）。
 * ⛔ `safeStorage` 在非 Electron 宿主（守卫的 stub）里可能整个不存在 ⇒ 一律可选链 + try 兜住，
 *   失败退化成"读不到密钥"，绝不抛。
 */
function decryptKey(value: unknown): string {
  const raw = String(value ?? "");
  if (!raw) return "";
  try {
    if (!safeStorage?.isEncryptionAvailable?.()) return "";
    return safeStorage.decryptString(Buffer.from(raw, "base64"));
  } catch { return ""; }
}

/** 加密成可落盘的 base64；不可用/失败返回空串（调用方据此决定"要不要冒险动原文"）。 */
function encryptKey(value: string): string {
  try {
    if (!value || !safeStorage?.isEncryptionAvailable?.()) return "";
    return safeStorage.encryptString(value).toString("base64");
  } catch { return ""; }
}

/** 落盘态 → 内存态。 */
function toMemoryEntry(entry: unknown): BuiltinPluginEntry | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const { encryptedKey, apiKey, ...rest } = entry as StoredPluginEntry;
  return { ...(rest as Omit<BuiltinPluginEntry, "apiKey">), apiKey: encryptedKey ? decryptKey(encryptedKey) : String(apiKey ?? "") };
}

export async function readBuiltinPlugins(): Promise<BuiltinPluginConfig> {
  try {
    const stored = JSON.parse(await fs.readFile(builtinPluginsFile, "utf8"));
    return { image: toMemoryEntry(stored?.image) };
  } catch { return {}; }
}

/**
 * 写盘（**唯一写入点**）：内存态 → 落盘态，密钥走加密。
 * ⛔ 加密不可用时退回明文 + 告警 —— 宁可存得下，也不能因为加密不可用就把用户的密钥吞掉
 *   （真发生的话界面会显示"密钥还在"，而文件里是明文；下一次保存会再尝试加密）。
 */
export async function writeBuiltinPlugins(cfg: BuiltinPluginConfig): Promise<void> {
  const toStored = (entry?: BuiltinPluginEntry): StoredPluginEntry | undefined => {
    if (!entry) return undefined;
    const { apiKey, ...rest } = entry;
    const key = String(apiKey ?? "");
    if (!key) return { ...rest };
    const encryptedKey = encryptKey(key);
    if (!encryptedKey) {
      console.warn("[builtin] safeStorage 不可用：内置插件密钥只能明文落盘（下次保存会再尝试加密）");
      return { ...rest, apiKey: key };
    }
    return { ...rest, encryptedKey };
  };
  const next: Record<string, StoredPluginEntry> = {};
  for (const kind of ["image"] as const) {
    const stored = toStored(cfg[kind]);
    if (stored) next[kind] = stored;
  }
  await fs.writeFile(builtinPluginsFile, JSON.stringify(next, null, 2), "utf8");
}

/**
 * 内存态配置 → 引擎进程环境变量（**只给密钥**：地址/模型在文件里是明文，不是秘密）。
 *
 * ⛔ 为什么必须走 env：`resources/tools/harness-media.mjs` 是**纯 Node 的命令行兜底**
 *   （老会话没有 `image_generate` MCP 工具时，模型按 developer_instructions 里的命令行调用它），
 *   它拿不到 Electron 的 safeStorage ⇒ 配置文件加密后它没有别的途径取密钥。
 *   env 由我们的引擎进程持有，**不落盘**、不进任何备份/目录列表。
 * ⛔ 10-30 撤 `CODEX_HARNESS_VISION_API_KEY`：视觉辅助插件整体移除。
 */
export function builtinPluginEnv(cfg: BuiltinPluginConfig): Record<string, string> {
  const env: Record<string, string> = {};
  const image = String(cfg.image?.apiKey ?? "").trim();
  if (image) env.CODEX_HARNESS_IMAGE_API_KEY = image;
  return env;
}

/**
 * 启动自愈：把存量**明文** `apiKey` 就地升级成密文（返回是否改过）。
 * ⛔ 不写 `.bak` —— 备份里躺一份明文等于没修；只在加密**确实成功**时才替换，失败原样留着。
 */
export async function migrateBuiltinPluginSecrets(): Promise<boolean> {
  let raw: any;
  try { raw = JSON.parse(await fs.readFile(builtinPluginsFile, "utf8")); } catch { return false; }
  let changed = false;
  for (const kind of ["image"] as const) {
    const entry = raw?.[kind];
    if (!entry || typeof entry !== "object") continue;
    const plain = String(entry.apiKey ?? "");
    if (!plain || entry.encryptedKey) continue;
    const encryptedKey = encryptKey(plain);
    if (!encryptedKey) continue;
    delete entry.apiKey;
    entry.encryptedKey = encryptedKey;
    changed = true;
  }
  if (!changed) return false;
  try { await fs.writeFile(builtinPluginsFile, JSON.stringify(raw, null, 2), "utf8"); } catch { return false; }
  return true;
}

export type SubAgentConfig = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  effort: string;
  inheritModel: boolean;
  model?: string;
  inheritSandbox: boolean;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  inheritApproval: boolean;
  approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export async function readSubAgents(): Promise<SubAgentConfig[]> {
  try {
    const list = JSON.parse(await fs.readFile(subAgentsFile, "utf8")) as SubAgentConfig[];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export async function writeSubAgents(list: SubAgentConfig[]) { await fs.writeFile(subAgentsFile, JSON.stringify(list, null, 2), "utf8"); }
