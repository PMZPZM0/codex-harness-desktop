/**
 * data-access/tool-defs（10-29）：给模型看的三个工具 —— 收藏夹 / 开发日记 / 密码本。
 *
 * 用户定的权限模型（原话）：
 *  「收藏夹 / 开发日记：会话级开关（默认关）。开启后允许 read + append（只追加，不删除、不覆盖历史）。
 *   密码本：默认永不进模型上下文；仅允许 copy / 存在性查询，即模型只能"帮你复制某个账号的密码到剪贴板"，
 *   拿不到明文；任何写入需一次性确认弹窗。
 *   一次授权粒度：按"会话 + 模块 + 读/写"三元组授权，结束会话即失效；删除类操作永远不开放给模型。」
 *
 * ⛔ 工具**永远出现在工具面上**（不带开关条件）—— dynamicTools 只在 thread/start / resume 定死，
 *    带条件就会出现"用户刚打开开关、模型仍然没有工具"。真正的拦截在执行端（主进程 dataaccess:*）：
 *    被拒时返回「未授权 + 去哪开」，模型能如实转述并引导用户。
 * ⛔ 三个工具**没有 delete / update** 动作：删除类操作不开放给模型（用户在界面上自己做）。
 * ⛔ 描述里不写"你可以读取全部密码"之类的话：密码明文永远不出主进程，模型拿到的只有复制结果。
 */
export const DATA_ACCESS_TOOLS = [
  {
    type: "function",
    name: "favorites",
    description:
      "用户的收藏夹（应用内左侧快捷条 →「收藏夹」）。"
      + "action=list 读取（可用 query 按关键词过滤）；action=append 追加一条新收藏（text 正文或 link 网址）。"
      + "⛔ 只能读和**追加**：改已有条目、删除、清空一律不允许（那是用户在界面上的操作）。"
      + "⛔ 默认关闭：本会话没被用户授权时会被拒绝，把「去 左侧快捷条 →「数据授权」里为本会话打开收藏夹的读/写」如实告诉用户，不要换别的办法绕。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "append"], description: "list=读取；append=追加一条" },
        query: { type: "string", description: "list 时的关键词过滤（标题/正文/备注/标签），可省略" },
        limit: { type: "number", description: "list 最多返回几条（默认 30，上限 100）" },
        title: { type: "string", description: "append 的标题（省略则从正文推）" },
        content: { type: "string", description: "append 的正文（text）或网址（link）" },
        kind: { type: "string", enum: ["text", "link"], description: "append 的类型，默认 text" },
        tags: { type: "array", items: { type: "string" }, description: "append 的标签，可省略" },
      },
      required: ["action"],
    },
  },
  {
    type: "function",
    name: "dev_journal",
    description:
      "用户的开发日记（应用内左侧快捷条 →「开发日记」；按天一个 Markdown）。"
      + "action=read 读某天全文（date 省略=今天）；action=search 全文检索（只回命中日期与命中行）；"
      + "action=append 追加一条记录（date 省略=今天；只追加到当天文件末尾）。"
      + "⛔ 只能读和**追加**：不允许整篇覆盖、不允许删除某天（那是用户在界面上的操作）。"
      + "⛔ 默认关闭：未授权会被拒绝，引导用户去 左侧快捷条 →「数据授权」为本会话打开开发日记的权限。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "search", "append"], description: "read=读某天；search=检索；append=追加" },
        date: { type: "string", description: "YYYY-MM-DD，省略=今天" },
        query: { type: "string", description: "search 的关键词" },
        title: { type: "string", description: "append 的小标题（会写成 `## HH:mm 标题`）" },
        body: { type: "string", description: "append 的正文" },
      },
      required: ["action"],
    },
  },
  {
    type: "function",
    name: "password_book",
    description:
      "用户的密码本（应用内左侧快捷条 →「密码本」；密码用系统 safeStorage 加密，**明文永远不进模型上下文**）。"
      + "action=find 存在性查询（按标题/用户名/网址模糊匹配，只回 id、标题、用户名、是否有密码）；"
      + "action=copy 把某条密码复制到系统剪贴板（返回里**没有明文**，让用户自己去粘贴）；"
      + "action=save 新增/更新一条（调用后用户会看到一个一次性确认弹窗，**用户点了允许才会真正写入**）。"
      + "⛔ 你永远看不到密码明文：不要向用户索要、不要试图用读文件的方式绕过。"
      + "⛔ 没有删除动作。⛔ 默认关闭：未授权会被拒绝，引导用户去 左侧快捷条 →「数据授权」。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["find", "copy", "save"], description: "find=查有没有；copy=复制到剪贴板；save=写入（需用户确认）" },
        query: { type: "string", description: "find 的匹配词（标题/用户名/网址），省略=列出全部" },
        id: { type: "string", description: "copy 必填：find 结果里的 id" },
        title: { type: "string", description: "save：名称（如「GitHub」）" },
        username: { type: "string", description: "save：账号/邮箱" },
        password: { type: "string", description: "save：密码（会在确认弹窗里以圆点显示，不会回显给模型）" },
        url: { type: "string", description: "save：登录网址，可省略" },
        note: { type: "string", description: "save：备注，可省略" },
      },
      required: ["action"],
    },
  },
];
