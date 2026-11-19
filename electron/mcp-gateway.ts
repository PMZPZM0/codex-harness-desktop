/**
 * MCP 网关（11-19 用户令：「MCP 62 个工具占了 4.8 万字符，优化一下」）。
 *
 * 问题：用户接的 MCP（TAPD 等）每个工具都整份 schema 常驻，实测 62 个工具 / 48,075 字符
 * （≈13k tokens/轮，占工具面 60%）。绝大多数会话一轮只用 0–1 个。
 *
 * 做法：**默认不注册逐个 MCP 工具**，改成两个网关工具：
 *   · `mcp_tools`  —— 按关键词找工具（返回名字 + 一句说明；按精确名字查会带完整 schema）
 *   · `mcp_call`   —— 按名字调用（参数原样转给 MCP）
 * 代价：多一次往返；收益：48k 字符 → 约 1.5k。
 *
 * ⛔ 不改变权限：调用仍走 `callMcpTool`（原有转发 + 剥 step + REA 特殊处理），本模块只负责 schema。
 * ⛔ 回滚：把 `MCP_LAZY` 置 false 即恢复「逐个注册」的旧行为（codex-ipc 里两处注入点都读它）。
 */

/** 是否启用懒加载（false = 逐工具注册，旧行为）。 */
export const MCP_LAZY = true;

/** 网关工具定义（dynamicTools 形状，与 buildDynamicTools 里的其它条目一致）。 */
export function buildMcpGatewayTools(): Array<Record<string, unknown>> {
  return [
    {
      type: "function",
      name: "mcp_tools",
      description:
        "列出/搜索已连接的 MCP 工具（TAPD、知识库、天眼查等）。"
        + "用法：query 传关键词（如「任务」「bug」「订单」），返回工具名 + 一句说明；"
        + "把 query 设成**精确工具名**则返回该工具的完整参数 schema。"
        + "⛔ 调用某个工具前先用它确认名字与参数；⛔ 它不会执行任何操作。",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "关键词或精确工具名（空=列出全部工具名，最多 40 条）" },
          service: { type: "string", description: "只看某个 MCP 服务（如 tapd），可选" },
          limit: { type: "number", description: "返回条数上限，默认 20" },
        },
        required: [],
      },
    },
    {
      type: "function",
      name: "mcp_call",
      description:
        "调用一个 MCP 工具（先用 mcp_tools 查名字与参数）。"
        + "args 是 JSON 对象，原样传给 MCP 服务；返回文本结果。"
        + "⛔ 名称必须是 mcp_tools 返回过的名字，不要凭空构造。",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "mcp_tools 返回的工具名（含服务前缀）" },
          args: { type: "object", description: "传给该工具的参数对象（字段见 mcp_tools 的 schema）" },
        },
        required: ["name"],
      },
    },
  ];
}
