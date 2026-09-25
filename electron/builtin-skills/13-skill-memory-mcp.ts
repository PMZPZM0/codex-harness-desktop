/**
 * builtin-skills 的「memory-mcp-backend」部分（09-25 新增）。
 *
 * 用途：当用户把**记忆后端切成 MCP 记忆服务**（设置 → 记忆 → 记忆后端 = MCP）后，
 * 引擎的记忆动作要从「往工作区 lessons/*.md 里写」切到「调用 MCP 记忆工具」。
 * 与 \`11-skill-memory-classify\` **互斥**：同一时刻只启用一个（见 builtin-skills.ts 的后端切换），
 * 否则模型会同时收到两套互相矛盾的写法（用户 09-25：「不要 mcp 写了记忆，又用金字塔记忆，这样重复了」）。
 *
 * ⛔ 正文必须是字面量（预检【86】按源文件文本做安全扫描）；正文里每个反引号都要写成 \\\` 转义。
 * ⛔ 工具名与参数口径**只写实测过的**（09-25 用自带 node 真起服务、跑 initialize + tools/list + 真实
 *    memory-write/memory-read/agent-context 往返，服务版本 0.49.0，共 19 个工具）：
 *      · 写入 \`memory-write\`（type 枚举 = code_fact / decision / mistake / pattern / task_archive；
 *        \`importance\` 是**数字 1–5**，⛔ 不是 "high"/"medium"；写错直接被 input validation 拒）
 *      · 读 \`memory-read\`（query→检索，id/code→详情，无参→recap）
 *      · \`agent-context\` 把记忆编译成带 token 预算的注入块（\`budget\` 是**对象**，如 {maxTokens:600}）
 *    并明确「以 tools/list 实际返回为准」——不编造工具名误导模型。
 * ⛔⛔ 为什么必须实测（09-25 教训）：上一版技能只写了「用它的 type 字段」+ 举例 \`memory-write\`，
 *    没写枚举与类型 ⇒ 模型按直觉传 \`type:"pitfall"\` / \`importance:"high"\`，**每次调用都被拒**，
 *    而界面上只表现为「记忆没存上」，极难归因。给模型的工具指引必须写到参数级。
 */
export const MEMORY_MCP_SKILL = `---
name: memory-mcp-backend
description: 记忆后端切成 MCP 记忆服务后的写法与读法。凡是要「记一下这个」时读它：写入一律走 MCP 记忆工具，不要再往工作区的 lessons/ 或 MEMORY.md 里写；读记忆优先用 MCP 检索。
---

# 记忆后端 = MCP 记忆服务

当前记忆后端是 **MCP 记忆服务**（可选安装的 \`@vheins/local-memory-mcp\`），不是内置记忆金字塔。
它提供的不只是记忆，还有任务/交接/标准/观测等工具（实测 v0.49.0 共 19 个）。下面只讲记忆主线。

## 写记忆：只走 MCP

用 \`memory-write\`（工具名以工具列表实际返回为准，客户端常带前缀如 \`mcp__local-memory__memory-write\`）：

- \`type\`（**枚举，必填**）：\`code_fact\` | \`decision\` | \`mistake\` | \`pattern\` | \`task_archive\`
  —— 踩过的坑/被纠正的事选 \`mistake\`；⛔ 没有 \`pitfall\` 这个值，传了会被 input validation 直接拒。
- \`title\` + \`content\`（一条只讲一件事，title 要能被将来检索命中）。
- \`importance\`：**数字 1–5**（⛔ 不是 "high"/"low" 字符串，也不是 0–10；超出范围会被拒）。
- \`owner\` / \`repo\`：数据边界。不传时会按当前工作目录自动推断，**跨项目复用或仓库名有歧义时显式传**。
- 可选 \`tags\`、\`supersedes\`（取代旧条）。

写入成功会返回编号（如 \`Stored [MEM-001] …\`），后续可用该编号更新/引用。

## 读记忆

- \`memory-read\`：三种模式自动切换 —— 传 \`query\` 走检索；传 \`id\`/\`code\` 取详情；都不传则 recap。
- \`agent-context\`：把记忆/任务/交接/标准等**编译成带 token 预算的上下文块**（\`budget\` 是**对象**，
  形如 \`{ "maxTokens": 600 }\`；\`sources\` 可选 memories/decisions/tasks/handoffs/standards/observations/code）。
  适合在开始一个任务前先拉一次，看有没有相关前情。
- 检索结果里 \`[N]\` 是该条重要度（1–5），\`[unacked]\` 表示尚未确认读过。
- 内置的常驻记忆（用户档案 \`USER.md\`、项目记忆 \`MEMORY.md\`）**仍会作为上下文自动注入**，这是只读的，
  与 MCP 不冲突；⛔ 不要试图把它"同步"进 MCP —— 那是把一份记忆再抄一遍。

## 什么时候切回内置

设置 → 记忆 → 记忆后端 切回「内置记忆金字塔」后，本技能会被停用、\`memory-classify\` 重新启用，
此后写记忆按 \`memory-classify\` 的四分类口径进 \`lessons/\`。
`;
