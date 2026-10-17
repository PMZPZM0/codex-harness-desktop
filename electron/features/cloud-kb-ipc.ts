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

const CHANNELS = ["cloud-kb:sync", "cloud-kb:status"];
const CONNECTOR_NAME = "知识库（云端）";

type SyncReply = { ok: boolean; action: string; url?: string; kbName?: string; error?: string };

export const cloudKbFeature = defineFeature<null>({
  id: "cloud-kb",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("cloud-kb: 缺少 ipc 服务（宿主未提供）");
    void CHANNELS;

    /* 拉集成凭据 → 写/停用连接器（幂等，可反复调）。 */
    ipcHost.handle("cloud-kb:sync", async (): Promise<SyncReply> => {
      const res = await fetchIntegrations();
      if (!res.ok) {
        return { ok: false, action: "absent", error: res.error || "integrations-failed" };
      }
      const kb = res.data?.knowledge ?? {};
      const url = String(kb.mcpUrl || "");
      const token = String(kb.mcpToken || "");
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
    });

    /* 只读本机状态（不联网）—— 界面用它显示"是否已接通"。 */
    ipcHost.handle("cloud-kb:status", async () => {
      const state = await readCloudMcpConnector(CLOUD_KB_CONNECTOR_ID);
      return { ...state, connectorId: CLOUD_KB_CONNECTOR_ID, tool: `mcp__${CLOUD_KB_CONNECTOR_ID}` };
    });
  },
});
