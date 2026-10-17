/**
 * cloud-memory（域，10-16）—— 云端**记忆**的接入。
 *
 * ⛔⛔ 本域**不生成 MCP 连接器**，也不该生成 —— 10-16 实测纠正了原先的判断：
 *   记忆中枢 `memapi.ppz123.asia` **没有任何记忆读写路由**（所有路径都是同一个 OpenAI 兼容转发口，
 *   连编造的 `/v1/memory/search` 也返回"请求必须指定 model"）⇒ **没有东西可以包成 MCP 工具**。
 *   真正的机制：`tdai-proxy` 的 `memory: { inject, writeL0, recallL1, injectL2L3 }` ——
 *   记忆在**对话请求这一层**自动注入 / 自动写入。
 *   ⇒ 正确接法 = 把**对话上游**切到 memapi（带该账号 userKey），而不是造工具。
 *     · 每账号一把 userKey ⇒ **独立的记忆命名空间**（这就是"每人一个记忆空间"的实现方式）；
 *     · 全部对话自动带上记忆，比"模型想起来才去查工具"可靠。
 *   ⛔ 上游地址只经 `cloud-provider` 的**单一决策点**落盘（记忆域只记"意图"）——
 *     否则 `cloud-models` 每 10 分钟的同步会把它刷回纯模型地址。
 *   ⛔ 若服务端将来在 `/integrations` 的 `memory` 里补上真正的 `mcpUrl`，本域会自动改走 MCP 分支。
 *
 * ⛔ 用户凭据（userKey）加密落盘；⛔ 不打日志。
 */
import fs from "node:fs";
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { cloudHome, decrypt, encrypt, fetchIntegrations } from "../cloud-api";
import { CLOUD_MEMORY_CONNECTOR_ID, readCloudMcpConnector, syncCloudMcpConnector } from "../cloud-mcp";
import { resyncCloudUpstream, setMemoryUpstream, readMemoryUpstream } from "../cloud-provider";

const CHANNELS = ["cloud-memory:sync", "cloud-memory:status"];
const CONNECTOR_NAME = "记忆（云端）";

type MemoryMode = "mcp" | "rest-only" | "not-activated";
type SyncReply = {
  ok: boolean;
  mode: MemoryMode;
  action?: string;
  error?: string;
  /** 生效的推理上游：「memory」= 记忆端点（对话自动注入/写入），「model」= 纯模型。 */
  upstream?: "memory" | "model";
  upstreamChanged?: boolean;
};

type MemoryCredentials = {
  baseUrl: string;
  instanceId: string;
  apiKeyHeader: string;
  encryptedUserKey: string;
  savedAt: number;
};

function credentialsFile(): string {
  return path.join(cloudHome(), "memory-integration.json");
}

function readCredentials(): MemoryCredentials | null {
  try {
    const raw = JSON.parse(fs.readFileSync(credentialsFile(), "utf8")) as MemoryCredentials;
    return raw && raw.encryptedUserKey ? raw : null;
  } catch {
    return null;
  }
}

function writeCredentials(input: { baseUrl: string; instanceId: string; apiKeyHeader: string; userKey: string }): boolean {
  const encryptedUserKey = encrypt(input.userKey);
  if (!encryptedUserKey) return false; // 安全存储不可用 ⇒ 宁可不存，也不写明文凭据
  const dir = cloudHome();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    credentialsFile(),
    JSON.stringify({ ...input, userKey: undefined, encryptedUserKey, savedAt: Date.now() }, null, 2),
    { mode: 0o600 },
  );
  return true;
}

export const cloudMemoryFeature = defineFeature<null>({
  id: "cloud-memory",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("cloud-memory: 缺少 ipc 服务（宿主未提供）");
    void CHANNELS;

    ipcHost.handle("cloud-memory:sync", async (): Promise<SyncReply> => {
      const res = await fetchIntegrations();
      if (!res.ok) return { ok: false, mode: "not-activated", error: res.error || "integrations-failed" };
      const mem = res.data?.memory ?? {};
      if (!mem.ok || !mem.baseUrl || !mem.userKey) {
        await syncCloudMcpConnector(null, CLOUD_MEMORY_CONNECTOR_ID);
        /* 未开通（或已过期/停用）⇒ 清掉记忆上游意图，模型请求切回「纯模型」地址。
           ⛔ 必须在这里也调一次：用户停用记忆后不能让对话继续走带记忆的端点。 */
        await setMemoryUpstream(null);
        await resyncCloudUpstream();
        return { ok: false, mode: "not-activated", error: mem.error || "not-activated" };
      }
      writeCredentials({
        baseUrl: String(mem.baseUrl),
        instanceId: String(mem.instanceId || ""),
        apiKeyHeader: String(mem.apiKeyHeader || "X-Tdai-User-Key"),
        userKey: String(mem.userKey),
      });
      /* ⛔⛔ 记忆**不是**靠工具调用的（10-16 实测）：memapi 对所有路径都是同一个 OpenAI 兼容转发口，
         没有任何记忆读写路由 —— 记忆是在「对话请求」这一层由 tdai-proxy 自动注入 / 自动写入。
         ⇒ 正确接法是把**对话上游**切到 memapi（带该账号自己的 userKey），记忆即全域生效，
            且天然按账号隔离（每账号一把 key = 一个独立记忆命名空间）。
         ⛔ 落盘只经 cloud-provider 的单一决策点，别在这里自己写 baseUrl。 */
      await syncCloudMcpConnector(null, CLOUD_MEMORY_CONNECTOR_ID);

      /* ① 服务端**若**给了真正的 MCP 端点 ⇒ 优先用连接器（当前不给；将来补上即自动生效）。 */
      const mcpUrl = String((mem as { mcpUrl?: string }).mcpUrl || "");
      if (mcpUrl) {
        const action = await syncCloudMcpConnector({
          id: CLOUD_MEMORY_CONNECTOR_ID,
          name: CONNECTOR_NAME,
          url: mcpUrl,
          token: String((mem as { mcpToken?: string }).mcpToken || ""),
          secretKey: "CLOUD_MEMORY_MCP_TOKEN",
        });
        return { ok: true, mode: "mcp", action, upstream: "model" };
      }

      /* ② 否则把对话上游切到记忆端点。⛔ safeStorage 不可用时不切（宁可没有记忆，也不写明文凭据）。 */
      const encryptedUserKey = encrypt(String(mem.userKey));
      if (!encryptedUserKey) return { ok: false, mode: "rest-only", error: "safe-storage-unavailable" };
      await setMemoryUpstream({ baseUrl: String(mem.baseUrl), encryptedUserKey });
      const applied = await resyncCloudUpstream();
      return { ok: true, mode: "rest-only", upstream: applied.memory ? "memory" : "model", upstreamChanged: applied.changed };
    });

    ipcHost.handle("cloud-memory:status", async () => {
      const connector = await readCloudMcpConnector(CLOUD_MEMORY_CONNECTOR_ID);
      const cred = readCredentials();
      const upstream = await readMemoryUpstream();
      return {
        connectorId: CLOUD_MEMORY_CONNECTOR_ID,
        connector,
        hasCredentials: Boolean(cred && decrypt(cred.encryptedUserKey)),
        mode: connector.enabled ? "mcp" : (cred ? "rest-only" : "not-activated"),
        /* 生效上游：memory = 对话走带记忆的端点（记忆自动注入/写入）；model = 纯模型。 */
        upstream: upstream ? "memory" : "model",
        note: upstream
          ? "对话上游已切到记忆端点：记忆在请求层自动注入与写入（每账号独立命名空间）"
          : "记忆未生效：对话走纯模型端点",
      };
    });
  },
});
