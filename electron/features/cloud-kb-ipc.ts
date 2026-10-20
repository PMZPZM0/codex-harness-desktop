/**
 * cloud-kb（域，10-16）—— 把**云端知识库**接成本机 MCP 连接器（`mcp_servers.cloud-kb`）。
 *
 * 契约（服务端实证）：`GET /integrations` 在权益已开通时返回
 *   `knowledge: { ok, kbId, kbName, mcpUrl, mcpToken }`
 * 其中 `mcpUrl` = `https://kb.ppz123.asia/mcp/<endpointId>`（WeKnora 自带 MCP 端点，实测可达）
 * ⇒ 可直接以 `streamable_http` 连接器接入，**不需要任何自建适配器**。
 *
 * ⛔ 未开通权益时服务端回 `{ ok:false, error:"not-activated" }`（它**不建库、不发钥匙**）——
 *   本域如实把连接器停用并回报原因，⛔ 不伪造一个连不上的连接器（那会让模型每轮都去试一个死端点）。
 *
 * ⛔ 令牌落 `connectors.json` 的 `encryptedSecrets`（safeStorage），经**环境变量**注入引擎子进程，
 *   **绝不写进 config.toml**（见基座 `../cloud-mcp`）。
 */
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { fetchIntegrations } from "../cloud-api";
import { CLOUD_KB_CONNECTOR_ID, CLOUD_KB_TOKEN_ENV, readCloudMcpConnector, syncCloudMcpConnector } from "../cloud-mcp";
import { mcpToolName } from "../backend-routing";

const CHANNELS = ["cloud-kb:sync", "cloud-kb:status"];
const CONNECTOR_NAME = "知识库（云端）";

type SyncReply = { ok: boolean; action: string; url?: string; kbName?: string; error?: string };

/**
 * 拉集成凭据 → 写 / 停用 `cloud-kb` 连接器（幂等，可反复调）。
 *
 * 10-20 抽成模块级函数：`cloud-kb:sync`（手动刷新）与 `applyKbBackend()`（切换知识库后端）
 * **共用同一实现** —— 两份实现必然漂移（一处补了 Bearer、另一处忘了 ⇒ 一个 200 一个 401）。
 */
async function syncKbConnector(): Promise<SyncReply> {
  const res = await fetchIntegrations();
  if (!res.ok) return { ok: false, action: "absent", error: res.error || "integrations-failed" };
  const kb = res.data?.knowledge ?? {};
  const url = String(kb.mcpUrl || "");
  const rawToken = String(kb.mcpToken || "");
  /* ⛔⛔ 10-19 实测：引擎的 `env_http_headers` 把环境变量的值**原样**写进请求头，**不会**自动
     加 `Bearer `（那是 `bearer_token_env_var` 才有的行为）。WeKnora 只认 `Authorization: Bearer <token>`
     ⇒ 只存裸 token 会得到 `Authorization: mcp_…` → 服务端回 `unauthorized: missing bearer token`
     （实测：裸 token 401 / 带 Bearer 200）。所以在**落盘前**补前缀，别指望引擎补。 */
  const token = rawToken && !/^Bearer\s/i.test(rawToken) ? `Bearer ${rawToken}` : rawToken;
  if (!kb.ok || !url || !token) {
    /* 未开通 / 服务端没配 WeKnora：**停用**连接器（不删），并把原因回给界面。 */
    const action = await syncCloudMcpConnector(null, CLOUD_KB_CONNECTOR_ID);
    return { ok: false, action, error: kb.error || "not-activated" };
  }
  const action = await syncCloudMcpConnector({
    id: CLOUD_KB_CONNECTOR_ID,
    name: CONNECTOR_NAME,
    url,
    token,
    secretKey: CLOUD_KB_TOKEN_ENV,
  });
  return { ok: true, action, url, kbName: String(kb.kbName || "") };
}

/** 连接器状态变了 ⇒ 桥接的 5 分钟工具缓存立即作废（否则切了后端、下一回合工具面还是旧的）。 */
async function bustBridgeCache(): Promise<void> {
  try { const { invalidateMcpBridgeCache } = await import("../mcp-bridge"); invalidateMcpBridgeCache(); }
  catch { /* 桥接未加载不影响同步 */ }
}

/**
 * 知识库后端切换的**联动**（10-20）：让连接器的启用状态跟着 `kbBackend` 走。
 *
 * ⛔⛔ 为什么必须联动：`kbBackend` 原先只是个设置项、**没有任何消费方** ——
 *   切回「本地」后 cloud-kb 连接器仍是 enabled，云端 6 个工具照样出现在模型工具列表里，
 *   模型于是拿云端工具去"检索本地库"：用户以为在查本地文档，实际查的是云端另一套数据。
 *   ⇒ cloud：拉凭据并启用连接器；local：停用连接器。两侧都**不删**连接器（切回来不用重配）。
 * ⛔ 由 `kb:backend-set` 通过能力探测调用（云助手仓没有本文件，那边降级为「只存设置」）。
 */
export async function applyKbBackend(backend: "local" | "cloud"): Promise<SyncReply> {
  /* ⛔ 提示层（developer_instructions 里的「知识库后端 = …」那一行）只在启动时自愈，
     同进程切换必须主动重建 —— 否则工具面已经是本地了，模型还被告知"用云端工具检索"。 */
  const refresh = async () => {
    try { const { refreshEngineInstructions } = await import("../backend-routing"); await refreshEngineInstructions(); }
    catch { /* 提示层刷新失败不影响切换 */ }
  };
  if (backend === "cloud") {
    const reply = await syncKbConnector();
    await bustBridgeCache();
    await refresh();
    return reply;
  }
  const action = await syncCloudMcpConnector(null, CLOUD_KB_CONNECTOR_ID);
  await bustBridgeCache();
  await refresh();
  return { ok: true, action };
}

export const cloudKbFeature = defineFeature<null>({
  id: "cloud-kb",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("cloud-kb: 缺少 ipc 服务（宿主未提供）");
    void CHANNELS;

    /* 拉集成凭据 → 写/停用连接器（幂等，可反复调）。 */
    ipcHost.handle("cloud-kb:sync", async (): Promise<SyncReply> => {
      const reply = await syncKbConnector();
      await bustBridgeCache();
      return reply;
    });

    /* 只读本机状态（不联网）—— 界面用它显示"是否已接通"。
       ⛔ 工具名必须与桥接实际暴露的一致（`cloud_kb__ask`，下划线、无 `mcp__`）——
          这里原先写 `mcp__cloud-kb`，与工具列表对不上，界面显示的就是一个不存在的名字。 */
    ipcHost.handle("cloud-kb:status", async () => {
      const state = await readCloudMcpConnector(CLOUD_KB_CONNECTOR_ID);
      return { ...state, connectorId: CLOUD_KB_CONNECTOR_ID, tool: mcpToolName(CLOUD_KB_CONNECTOR_ID, "ask") };
    });
  },
});
