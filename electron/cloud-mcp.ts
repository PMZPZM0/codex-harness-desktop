/**
 * cloud-mcp（基座层，10-16）—— 把云端的记忆 / 知识库接成本机的 **MCP 连接器**。
 *
 * 定位：`cloud-kb` 与 `cloud-memory` 两个域共用同一套落盘逻辑 ⇒ 基座层（不注册任何通道）。
 * 落点 = `userData/connectors.json`（既有 `connector-store` 的单一真相源，⛔ 不另建一份存储）。
 *
 * ⛔⛔ **令牌绝不落 config.toml**：连接器把 secret 放在 `encryptedSecrets`（safeStorage 加密），
 *   并用 `envHttpHeaders` 声明「哪个请求头取哪个环境变量」；harness 生成
 *   `[mcp_servers.<id>]` 时只写 `bearer_token_env_var`，令牌经**引擎子进程环境**注入。
 *   这与仓库既有的 `weknora-kb` 连接器同款（临时脚本 `add-weknora-connector.cjs` 实证）。
 *
 * ⛔ 为什么知识库能直接当 MCP、记忆不能：实测 `https://kb.ppz123.asia/v1/mcp` 返回 200
 *   （WeKnora 自带 MCP 端点，账号服务 `/integrations` 会下发每人的 `mcpUrl` + `mcpToken`），
 *   而记忆中枢 `memapi.ppz123.asia` 的 `/mcp`、`/v1/mcp`、`/sse` **全部 404** —— 它只有 REST
 *   （`/v1` + `X-Tdai-User-Key`）。⇒ 记忆要进 MCP 必须先有一个**本地 stdio 适配器**把 REST 包成
 *   MCP 工具；在适配器落地前 `cloud-memory` 域只会报 `no-mcp-endpoint`，不会伪造一个能用的连接器。
 *
 * ⛔ 幂等判据 = 「url + 启用态 + **令牌明文**」三者都一致才不写盘。只比 enabled 的话，
 *   令牌轮换后行里会永远留着上一枚（"界面显示已配置、调用一直 401"）。
 */
import fs from "node:fs/promises";
import { connectorsFile } from "./runtime-paths";
import { decrypt, encrypt } from "./cloud-api";
import type { ConnectorConfig } from "./main/07-connectors-io";

/** 知识库连接器 id（= 引擎 `[mcp_servers.cloud-kb]`）。 */
export const CLOUD_KB_CONNECTOR_ID = "cloud-kb";
/** 记忆连接器 id（= 引擎 `[mcp_servers.cloud-memory]`）。 */
export const CLOUD_MEMORY_CONNECTOR_ID = "cloud-memory";
/** 令牌环境变量名（`envHttpHeaders` 的值指向它）。 */
export const CLOUD_KB_TOKEN_ENV = "CLOUD_KB_MCP_TOKEN";

export type CloudMcpSpec = {
  /** 连接器 id（进 config.toml 的表名，⛔ 只允许 `[A-Za-z0-9_-]`）。 */
  id: string;
  /** 显示名。 */
  name: string;
  /** MCP 端点（streamable_http）。 */
  url: string;
  /** 访问令牌明文（本函数内即刻加密，⛔ 不落盘明文、不打日志）。 */
  token: string;
  /** 承载令牌的请求头名 → 环境变量名映射里**取值用的环境变量名**。 */
  secretKey: string;
};

export type CloudMcpState = {
  exists: boolean;
  enabled: boolean;
  url: string;
  hasToken: boolean;
};

export type SyncAction = "enabled" | "disabled" | "absent";

async function readConnectors(): Promise<ConnectorConfig[]> {
  try {
    const raw = JSON.parse(await fs.readFile(connectorsFile, "utf8"));
    return Array.isArray(raw) ? (raw as ConnectorConfig[]) : [];
  } catch {
    return [];
  }
}

async function writeConnectors(list: ConnectorConfig[]): Promise<void> {
  await fs.writeFile(connectorsFile, JSON.stringify(list, null, 2), "utf8");
}

export async function readCloudMcpConnector(id: string): Promise<CloudMcpState> {
  const list = await readConnectors();
  const row = list.find((entry) => entry?.id === id);
  if (!row) return { exists: false, enabled: false, url: "", hasToken: false };
  return {
    exists: true,
    enabled: row.enabled !== false,
    url: String(row.url || ""),
    hasToken: Boolean(Object.keys(row.encryptedSecrets ?? {}).length),
  };
}

/**
 * 写入/更新云 MCP 连接器。`spec = null` ⇒ 仅把已有条目**停用**（⛔ 不删条目：保留用户其它字段，
 * 下次登录原地复用；这同 `memory-mcp-connector` 的语义一致）。
 *
 * ⛔ safeStorage 不可用时**拒绝写入**（宁可让连接器不出现，也不写明文令牌），返回 `absent`。
 */
export async function syncCloudMcpConnector(spec: CloudMcpSpec | null, idForNull?: string): Promise<SyncAction> {
  const list = await readConnectors();
  const targetId = spec?.id ?? String(idForNull || "");
  const index = list.findIndex((entry) => entry?.id === targetId);

  if (!spec) {
    if (index < 0 || list[index].enabled === false) return "absent";
    list[index] = { ...list[index], enabled: false, updatedAt: new Date().toISOString() };
    await writeConnectors(list);
    return "disabled";
  }

  const encrypted = encrypt(spec.token);
  if (!encrypted) return "absent";

  const now = new Date().toISOString();
  if (index >= 0) {
    const cur = list[index];
    const same =
      cur.url === spec.url &&
      cur.enabled !== false &&
      (cur.envHttpHeaders?.Authorization === spec.secretKey) &&
      decrypt(cur.encryptedSecrets?.[spec.secretKey]) === spec.token;
    if (same) return "enabled"; // 幂等：一致就不写盘
    list[index] = {
      ...cur,
      name: spec.name,
      transport: "streamable_http",
      url: spec.url,
      headers: {},
      envHttpHeaders: { Authorization: spec.secretKey },
      encryptedSecrets: { [spec.secretKey]: encrypted },
      enabled: true,
      updatedAt: now,
    };
  } else {
    list.push({
      id: spec.id,
      name: spec.name,
      transport: "streamable_http",
      url: spec.url,
      headers: {},
      envHttpHeaders: { Authorization: spec.secretKey },
      encryptedSecrets: { [spec.secretKey]: encrypted },
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  await writeConnectors(list);
  return "enabled";
}
