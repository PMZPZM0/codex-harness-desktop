/**
 * config.toml 的读写边界。
 *
 * 这个文件存在的理由：harness 每次保存模型/个性化都会整份重写 config.toml，
 * 写错一个字节引擎就起不来，所以「哪些段落归 harness、哪些要原样留给用户」
 * 必须集中在一处，并且能被 scripts/check-config-toml.cjs 单独跑测试。
 */

/** harness 自己会重新生成的顶层键 */
export const HARNESS_CONFIG_KEYS = new Set(["model", "model_context_window", "model_provider", "developer_instructions", "model_catalog_json"]);

/** harness 自己会整段重写的表；其余段落（用户手工配置的 projects / marketplaces / plugins 等）原样保留 */
export const HARNESS_CONFIG_SECTIONS = new Set(["model_providers", "windows", "tools", "sandbox_workspace_write", "shell_environment_policy", "features", "mcp_servers", "otel", "permissions"]);

/** 只认整行就是表头的写法，避免把段落里以 [ 开头的值误判成新段落 */
const SECTION_LINE = /^\s*\[\[?\s*([A-Za-z0-9_.'"-]+)[^\]]*\]\]?\s*(?:#.*)?$/;

/**
 * 从现有 config.toml 中挑出 harness 不拥有的键与段落，原样留待拼回新配置尾部。
 * 注意 mcp_servers 永远会被丢掉：连接器与内置 nuphus 由 harness 重新生成，
 * 用户手工写的那些由 readUserConfigSplit 按覆盖表决定是否拼回。
 * otel 由 harness 重写（默认 exporter="none" 关闭遥测落库），不再留给用户段。
 * permissions 由 harness 重写（按 MCP 覆盖表聚合输出 per-tool 权限），不再留给用户段。
 */
export function preserveUserConfig(existing: string): string {
  const kept: string[] = [];
  let atTopLevel = true;
  let skipping = false;
  let inBlockString = false;
  for (const line of existing.split(/\r?\n/)) {
    if (inBlockString) {
      // 多行字符串内部一律随所属键/段一起丢弃，否则残留内容会污染新配置
      if (line.includes('"""')) { inBlockString = false; if (atTopLevel) skipping = false; }
      continue;
    }
    const section = line.match(SECTION_LINE);
    if (section) {
      atTopLevel = false;
      skipping = HARNESS_CONFIG_SECTIONS.has(section[1].split(".")[0]);
      if (!skipping) kept.push(line);
      continue;
    }
    if (atTopLevel) {
      const scalar = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/);
      if (scalar && HARNESS_CONFIG_KEYS.has(scalar[1])) {
        // 由 harness 重新生成；若值是多行字符串，要把整块一起跳过
        if ((line.match(/"""/g) ?? []).length === 1) { inBlockString = true; skipping = true; }
        continue;
      }
      skipping = false;
    }
    if (!skipping) kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 列出 config.toml 里所有 [mcp_servers.X] 的 X（支持带引号的写法） */
export function collectMcpServerNames(raw: string): string[] {
  const names: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*\[mcp_servers\.\s*([A-Za-z0-9_'".-]+)\s*\]\s*(?:#.*)?$/);
    if (!match) continue;
    const name = match[1].replace(/^['"]|['"]$/g, "");
    if (name) names.push(name);
  }
  return names;
}

/**
 * 抠出 [mcp_servers.X] 整段（含表头）。
 * 用户手工写进去的 MCP 没有连接器记录，停用前必须把原文存下来，否则启用时无从恢复。
 */
export function extractMcpSection(raw: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const header = new RegExp(`^\\s*\\[mcp_servers\\.(?:${escaped}|"${escaped}"|'${escaped}')\\]\\s*(?:#.*)?$`);
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => header.test(line));
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (SECTION_LINE.test(lines[i])) { end = i; break; }
  }
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end).join("\n");
}
