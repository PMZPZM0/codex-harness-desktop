/**
 * connector-store（10-03 从 `features/connectors-mcp-ipc/01-prompt-enhance.ts` **下沉到基座层**）
 *
 * 为什么下沉：`publicConnector` / `writeConnectors` 同时被 `connectors` 域与 `mcp-servers` 域使用。
 * 按前缀拆开后两个域是**不同板块**，板块之间只能经基座层 / barrel 交互 —— 若仍从某个域的内部
 * 文件导出，就变成"域 A import 域 B 的内部文件"（违反分层，且拆了等于没拆）。
 *
 * 判据（`ARCHITECTURE-RULES.md` §1.1）：不注册任何 IPC 通道、只是给别人用的基础设施 ⇒ 属**基座层**，
 * 放 `electron/` 根、不进 `features/`。
 */
import fs from "node:fs/promises";
import { connectorsFile } from "./main";
import type { ConnectorConfig } from "./main";

/** 对外视图：密钥一律不下发（只给 hasSecrets 与键名），避免把 secret 送进渲染层。 */
export type PublicConnectorConfig = Omit<ConnectorConfig, "headers" | "envHttpHeaders" | "env" | "encryptedSecrets"> & {
  hasSecrets: boolean;
  headerKeys: string[];
  envKeys: string[];
  envHttpHeaderKeys: string[];
};

export function publicConnector(value: ConnectorConfig): PublicConnectorConfig {
  const { headers, env, encryptedSecrets, ...rest } = value;
  return { ...rest, hasSecrets: Boolean(Object.keys(encryptedSecrets ?? {}).length), headerKeys: Object.keys(headers ?? {}), envKeys: Object.keys(env ?? {}), envHttpHeaderKeys: Object.keys(value.envHttpHeaders ?? {}) };
}

export async function writeConnectors(list: ConnectorConfig[]) { await fs.writeFile(connectorsFile, JSON.stringify(list, null, 2), "utf8"); }
