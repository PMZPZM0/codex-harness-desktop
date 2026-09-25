/**
 * builtin-skills 的「memory-mcp-backend」部分（09-25 新增）。
 *
 * 用途：当用户把**记忆后端切成 MCP 记忆服务**（设置 → 记忆 → 记忆后端 = MCP）后，
 * 引擎的记忆动作要从「往工作区 lessons/*.md 里写」切到「调用 MCP 记忆工具」。
 * 与 \`11-skill-memory-classify\` **互斥**：同一时刻只启用一个（见 builtin-skills.ts 的后端切换），
 * 否则模型会同时收到两套互相矛盾的写法（用户 09-25：「不要 mcp 写了记忆，又用金字塔记忆，这样重复了」）。
 *
 * ⛔ 正文必须是字面量（预检【86】按源文件文本做安全扫描）；正文里每个反引号都要写成 \\\` 转义。
 * ⛔ 工具名只写 README 里实证出现过的（memory-write / agent-context / codebase-read），
 *    并明确「以 tools/list 实际返回为准」——不编造工具名误导模型。
 */
export const MEMORY_MCP_SKILL = `---
name: memory-mcp-backend
description: 记忆后端切成 MCP 记忆服务后的写法与读法。凡是要「记一下这个」时读它：写入一律走 MCP 记忆工具，不要再往工作区的 lessons/ 或 MEMORY.md 里写；读记忆优先用 MCP 检索。
---

# 记忆后端 = MCP 记忆服务

当前记忆后端是 **MCP 记忆服务**（可选安装的 \`@vheins/local-memory-mcp\`），不是内置记忆金字塔。

## 写记忆：只走 MCP

要记一条东西（踩的坑、被纠正的事、定下的流程、用户偏好）时：

1. 用 MCP 记忆服务提供的**写入工具**写一条（常见名 \`memory-write\`；结构化决策可用它的 \`type\` 字段）。
   ⛔ 工具名以客户端 MCP 工具列表里**实际返回的为准**（不同客户端前缀不同，如 \`mcp__local-memory__memory-write\`）——
   先用工具列表确认，不要照抄名字硬调。
2. 一条记忆只讲一件事，标题/摘要要能被将来检索命中（写「现象 + 结论」，不要写成流水账）。
3. ⛔ **不要**再往 \`.codex-harness/memory/lessons/*.md\`、\`MEMORY.md\`、日志里写同一条 ——
   内置写入已被后端开关挡住（写了也进不去），重复写只会让你自己在两个地方维护两套记忆。

## 读记忆

- 优先用 MCP 记忆服务的检索/上下文工具（常见名 \`agent-context\` 取会话上下文、\`codebase-read\` 查代码符号）。
- 内置的常驻记忆（用户档案 \`USER.md\`、项目记忆 \`MEMORY.md\`）**仍会作为上下文自动注入**，这是只读的，
  与 MCP 不冲突；⛔ 不要试图把它"同步"进 MCP —— 那是把一份记忆再抄一遍。

## 什么时候切回内置

设置 → 记忆 → 记忆后端 切回「内置记忆金字塔」后，本技能会被停用、\`memory-classify\` 重新启用，
此后写记忆按 \`memory-classify\` 的四分类口径进 \`lessons/\`。
`;
