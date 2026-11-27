/**
 * 工具面画像（11-19 用户令：「工具很多都不是必须要的，保留几个官方自带的；工具和技能都可以按专家和普通会话来，
 * 普通会话不需要常驻这么多工具，专家都有自己一套工具和技能」「专家会话也按岗位（产品/工程/设计）给子集」）。
 *
 * 做法：**不删工具实现**，只按会话类型决定「哪些 schema 进 tool surface」——
 *   普通会话 = CORE；专家/团队会话 = CORE + 岗位增量。其余能力仍可通过 `harness_tools` 网关调用
 *   （网关只有一个 schema，成本固定）。
 *
 * ⛔ 两个不变量：
 *  1. **CORE 必须自足**：任务管理、记忆、技能安装、调度、网关 —— 少一个就会出现"普通会话干不了活"。
 *  2. **画像只影响 schema 的可见性，不影响权限** —— 执行闸仍在主进程各 handler 里，不允许拿这里当安全边界。
 *  3. 回滚开关：把 `TOOL_PROFILES_ENABLED` 置 false 即恢复全量（不删任何代码）。
 */

/** 是否启用画像裁剪。⛔ 关掉 = 恢复旧行为（全量工具面），用于线上出问题时的紧急回滚。 */
export const TOOL_PROFILES_ENABLED = true;

/** 普通会话常驻（模型每轮都看得到 schema 的那些）。⛔ 加名字前先问：普通会话真的每一轮都可能用它吗？ */
export const CORE_TOOLS: readonly string[] = [
  // 调度与网关（其余能力都从网关进）
  "harness_tools",
  "agent_invoke",
  "agent_ask",
  "agent_list_children",
  "agent_archive_sessions",
  // 会话自身
  "compact_context",
  // 记忆
  "memory_recall",
  "memory_write",
  // 任务清单
  "task_add",
  "task_update",
  // 技能（装之前必须过 skill_audit，规则在指令里）
  "skill_search",
  "skill_install",
  /* 11-19：技能按需检索（清单只给 60 字索引，命中不了的靠它找） */
  "find_skills",
  /* 11-19：MCP 懒加载的两个入口 */
  "mcp_tools",
  "mcp_call",
  /* 图像（用户日常用得最多的一件）：生成与预览常驻；`image_edit` / `image_info` 走能力网关
     （11-27 起网关能转发渲染层工具），⛔ 别再塞回 CORE —— 一份 schema 常驻约 1.1K token。 */
  "image_generate",
  "image_view",
  /* 11-24 用户令：「codex 要知道侧边栏可以展示 PPT 进度」—— 普通会话做演示稿是主场景，
     ⛔ 不能只挂在岗位增量里（那样只有产品/设计专家会话看得见，普通会话既没 schema、
     网关也调不通：它的执行在渲染层，主进程能力表里没有这个名）。 */
  "slide_show",
];

/** 已知的宿主工具名目录（只裁这些；⛔ MCP 连接器工具名带 `__` 前缀，一律保留）。
 *  新增宿主工具时加进这里，否则它会「默认保留」——等于没裁。 */
export const HOST_TOOL_CATALOG: readonly string[] = [
  "harness_tools", "agent_invoke", "agent_ask", "agent_list_children", "agent_archive_sessions",
  "compact_context", "memory_recall", "memory_write", "task_add", "task_update",
  "skill_search", "skill_install", "find_skills", "mcp_tools", "mcp_call", "laya_judge", "image_generate", "image_view", "image_edit", "image_info",
  "media_search", "media_detail", "media_preview", "photocraft", "frontend_get_doc", "frontend_apply_doc",
  "ui_component_search", "ui_component_get", "design_md", "github_trending",
  "connector_search", "connector_install", "feishu_cli", "filee_convert", "openmaic", "apkstart", "husk",
  "rpa_save", "rpa_run", "rpa_schedule",
  "openfilm_status", "openfilm_make_film", "openfilm_check", "openfilm_render", "openfilm_get", "openfilm_skill",
  /* 11-24：幻灯片推到侧栏实时预览（模型只给内容，版式由宿主渲染）。 */
  "slide_show",
];

/** 岗位增量：按专家 profession / 团队 category 里的关键词匹配，命中即并入。 */
export const ROLE_EXTRAS: Record<string, readonly string[]> = {
  // 产品 / 运营 / 内容
  product: ["media_search", "media_detail", "media_preview", "skill_search", "memory_recall", "github_trending", "slide_show"],
  // 工程 / 研发 / 后端 / 前端
  engineering: [
    "frontend_get_doc", "frontend_apply_doc", "ui_component_search", "ui_component_get", "design_md",
    "github_trending",
    "connector_search", "connector_install",
    "feishu_cli", "filee_convert", "openmaic", "apkstart", "husk",
    "rpa_save", "rpa_run", "rpa_schedule",
  ],
  // 设计 / 视觉 / 影音
  design: [
    "frontend_get_doc", "frontend_apply_doc", "ui_component_search", "ui_component_get", "design_md",
    "image_edit", "image_info", "photocraft", "slide_show",
    "media_search", "media_detail", "openfilm_status", "openfilm_make_film", "openfilm_get",
  ],
};

/** 把一句自由文本（专家 profession / 岗位 / 团队名）映射成岗位 key；识别不出时返回 null（= 不收窄）。 */
export function roleKeyOf(text: string): string | null {
  const raw = String(text ?? "");
  if (/设计|视觉|美术|影音|剪辑|UI|UX/i.test(raw)) return "design";
  if (/工程|研发|开发|后端|前端|架构|测试|运维|DevOps|程序员/i.test(raw)) return "engineering";
  if (/产品|运营|内容|市场|增长|文案|自媒体|编辑/i.test(raw)) return "product";
  return null;
}

/** 允许集合：普通会话 = CORE；专家会话 = CORE + 岗位增量；null = 不裁剪（回滚/未知角色）。 */
export function allowedToolsFor(kind: "normal" | "expert", roleText = ""): readonly string[] {
  if (!TOOL_PROFILES_ENABLED) return [];
  if (kind === "normal") return CORE_TOOLS;
  const key = roleKeyOf(roleText);
  if (!key) return CORE_TOOLS;
  return [...CORE_TOOLS, ...(ROLE_EXTRAS[key] ?? [])];
}

/** 过滤工具面：只按名字筛，⛔ 不改工具对象本身（step 注入等由调用方负责）。 */
export function filterToolSurface<T>(tools: readonly T[], allowed: readonly string[]): T[] {
  if (!allowed.length) return [...tools];
  const allow = new Set(allowed);
  const catalog = new Set(HOST_TOOL_CATALOG);
  const kept: T[] = [];
  const dropped: string[] = [];
  for (const tool of tools) {
    const name = String((tool as { name?: unknown })?.name ?? (tool as { function?: { name?: unknown } })?.function?.name ?? "");
    /* 11-19 白名单模式（用户：「保留几个官方自带的，其他看看怎么优化」）：
       · MCP 连接器（名字以 mcp_ 开头，含 mcp_server_tapd__* / cloud_kb__*）一律保留 —— 删了用户接的 MCP 就没了；
       · 其余**必须**在 CORE/岗位白名单里，不在就收进网关（schema 不常驻，能力仍可由 harness_tools 调到）。
       ⛔ 这是 schema 可见性，不是权限：执行闸仍在各 handler。 */
    if (!name || name.startsWith("mcp_") || allow.has(name)) kept.push(tool);
    else dropped.push(name);
  }
  if (dropped.length) {
    console.log(`[tool-profile] 收窄工具面：保留 ${kept.length} 个，收进网关 ${dropped.length} 个（${dropped.slice(0, 12).join(",")}${dropped.length > 12 ? "…" : ""}）`);
  }
  return kept;
}
