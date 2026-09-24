/**
 * main 的「connector-config」部分（09-22 从同目录 main.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { ChannelBotService, type ChannelBotConfig } from "../channel-bot";
import { collectMcpServerNames, escapeTomlString, extractMcpSection, injectMcpToolRules, injectSectionExtras, preserveUserConfig, tomlBareKey, type McpToolRules } from "../config-toml";
import { server } from "../runtime-refs";
import type { McpOverrides } from "./06-mcp-overrides";
import { decryptSecret, escapeToml, safeConnectorId, type ConnectorConfig } from "./07-connectors-io";
import { readStoredChannelBot } from "./08-channel-bot-io";
/** 把覆盖表里的 per-tool 规则整理成 `服务器名 → {deny,ask,allow}`，交给
 *  `injectMcpToolRules` 落到 config.toml 里引擎真正认的键上（见上方 09-16 实证说明）。 */
export function mcpToolRulesOf(overrides: McpOverrides): Record<string, McpToolRules> {
  const rules: Record<string, McpToolRules> = {};
  for (const [server, entry] of Object.entries(overrides)) {
    if (!entry?.permissions) continue;
    const bucket: McpToolRules = { deny: [], ask: [], allow: [] };
    for (const [tool, mode] of Object.entries(entry.permissions)) {
      if (!tool || (mode !== "deny" && mode !== "ask" && mode !== "allow")) continue;
      bucket[mode].push(tool);
    }
    if (bucket.deny.length || bucket.ask.length || bucket.allow.length) rules[server] = bucket;
  }
  return rules;
}

export function connectorEnv(list: ConnectorConfig[]) {
  const result: Record<string, string> = {};
  for (const connector of list) {
    // 停用的连接器：密钥不再注入引擎环境，与「不写入 config.toml」保持一致
    if (connector.enabled === false) continue;
    for (const [key, encrypted] of Object.entries(connector.encryptedSecrets ?? {})) {
      const value = decryptSecret(encrypted);
      if (value) result[key] = value;
    }
  }
  return result;
}

export function connectorToml(list: ConnectorConfig[]) {
  const lines: string[] = [];
  for (const connector of list) {
    // 停用的连接器整段跳过：引擎侧完全没有该 MCP，而不是加载后靠 enabled 字段生效
    if (connector.enabled === false) continue;
    const id = safeConnectorId(connector.id);
    if (!id) continue;
    lines.push("", `[mcp_servers.${id}]`);
    if (connector.transport === "stdio") {
      if (!connector.command) continue;
      lines.push(`command = "${escapeToml(connector.command)}"`);
      if (connector.args?.length) lines.push(`args = [${connector.args.map((arg) => `"${escapeToml(arg)}"`).join(", ")}]`);
      // env 的**键**也必须转义加引号（09-16，Bug 5 同族）：键名来自用户输入，此前是裸插值
      // → 键里带 `"` 或 `}` 就能闭合内联表往外注入内容（同段里的 env_http_headers 早就转义了，
      //    两处不一致本身就是漏）。
      if (Object.keys(connector.env ?? {}).length) lines.push(`env = { ${Object.entries(connector.env ?? {}).map(([key, value]) => `"${escapeToml(key)}" = "${escapeToml(String(value))}"`).join(", ")} }`);
    } else {
      if (!connector.url) continue;
      lines.push(`url = "${escapeToml(connector.url)}"`);
      // envHttpHeaders：HTTP header 名 -> 环境变量名。密钥走 connectorEnv 注入，不落盘到 config.toml。
      if (Object.keys(connector.envHttpHeaders ?? {}).length) lines.push(`env_http_headers = { ${Object.entries(connector.envHttpHeaders ?? {}).map(([key, value]) => `"${escapeToml(key)}" = "${escapeToml(value)}"`).join(", ")} }`);
      const tokenKey = Object.keys(connector.encryptedSecrets ?? {})[0];
      if (tokenKey && !Object.keys(connector.envHttpHeaders ?? {}).length) lines.push(`bearer_token_env_var = "${escapeToml(tokenKey)}"`);
    }
    lines.push("startup_timeout_sec = 20");
  }
  return lines;
}

export async function readChannelBot(): Promise<ChannelBotConfig | null> {
  const stored = await readStoredChannelBot();
  if (!stored) return null;
  return {
    enabled: stored.enabled,
    host: stored.host,
    port: stored.port,
    workspace: stored.workspace,
    sandbox: stored.sandbox,
    appId: stored.appId,
    appSecret: decryptSecret(stored.encryptedAppSecret),
    verificationToken: decryptSecret(stored.encryptedVerificationToken),
    encryptKey: decryptSecret(stored.encryptedEncryptKey),
  };
}
