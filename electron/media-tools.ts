/**
 * 影视能力的**模型工具面**（11-01 用户令：Codex 要在普通会话里就能搜片、放片）。
 *
 * ⛔⛔ 为什么必须重做一遍（原来这套只在 harness-dispatch MCP 里）：
 *   `media_preview` / `media_source_open` 挂在 harness-dispatch 这个 MCP 服务器上，
 *   而那条链路有**身份硬闸**（`delegate-harness-tool.ts:97`）：只放行「被委派 / 团队会话」。
 *   普通对话会话一个条件都不满足 ⇒ 模型调用必被拒（用户实测提示「不是调度 / 团队会话」）。
 *   ⇒ 正确做法是把媒体能力提到**宿主 dynamicTools**（每个会话 thread/start 注入），
 *     而不是去放宽那条安全闸。工具可见 ≠ 操作被允许：真正的限制在 media-sources.ts 里。
 *
 * ⛔ 媒体源与播放内核都是现成的，这里只做「工具 → 既有实现」的接线，不复制业务逻辑：
 *   · 搜索 / 详情 / 起播  = `media-sources.ts`（苹果CMS 源，配置已内置）
 *   · 对话内播放          = `media-preview:open` 事件（渲染层 MediaPreview 自挂载）
 */

const TOOL_NAMES = ["media_search", "media_detail", "media_preview"] as const;

/** 工具定义（`item/tool/call` 由 `handleMediaToolCall` 应答）。 */
export function buildMediaTools(): any[] {
  return [
    {
      type: "function",
      name: "media_search",
      description:
        "在**内置影视源**（苹果CMS 系列：非凡 / 量子 / 光速 / 暴风 …）里按片名搜索影片或剧集。"
        + "用户说「放个电影 / 找部片子 / 有什么剧」时先用它，别直接说做不到。"
        + "返回每条结果的源、片名、更新状态与 vodId；下一步用 media_detail 拿播放地址。",
      inputSchema: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "片名关键词（中文即可）" },
          page: { type: "number", description: "页码，缺省 1" },
        },
        required: ["keyword"],
      },
    },
    {
      type: "function",
      name: "media_detail",
      description:
        "取某部影片/剧集的**播放地址列表**（按线路分组、按集排序）。"
        + "参数来自 media_search 的结果：sourceKey + vodId。"
        + "拿到第一条 m3u8 之后直接用 media_preview 起播，不需要再问用户。",
      inputSchema: {
        type: "object",
        properties: {
          sourceKey: { type: "string", description: "源标识（media_search 返回）" },
          vodId: { type: "string", description: "影片 id（media_search 返回）" },
        },
        required: ["sourceKey", "vodId"],
      },
    },
    {
      type: "function",
      name: "media_preview",
      description:
        "在**对话里的播放器**直接播放一个视频地址（m3u8 / mp4）。"
        + "用户说「放给我看 / 播一下」时调用它，而不是让用户自己去开浏览器。"
        + "返回成功后告诉用户已开始播放，并说明是哪个片源。",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "视频地址（m3u8 或 mp4）" },
          title: { type: "string", description: "标题，显示在播放器上" },
        },
        required: ["url"],
      },
    },
  ];
}

/** 是否是本模块负责的工具名。 */
export function isMediaTool(name: string): boolean {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * 在主进程应答 `item/tool/call`。
 * ⛔ 必须放主进程：后台会话（专家 / 子智能体）的事件会被 filterForRenderer 裁掉，
 *   放渲染层应答的话这类会话调用会一直挂到超时（与 openfilm / team 工具同一教训）。
 */
export async function handleMediaToolCall(input: {
  event: { id?: string | number; method?: string; params?: any };
  respond: (id: string | number, result: unknown) => void;
}): Promise<boolean> {
  const { event, respond } = input;
  if (String(event?.method ?? "") !== "item/tool/call") return false;
  const tool = String(event?.params?.tool ?? "");
  if (!isMediaTool(tool)) return false;
  const id = event?.id;
  if (id === undefined || id === null) return false;

  const args = (() => {
    const raw = event?.params?.arguments;
    if (typeof raw === "string") { try { return JSON.parse(raw) as any; } catch { return {} as any; } }
    return (raw && typeof raw === "object") ? raw as any : {};
  })();

  const reply = (ok: boolean, text: string) =>
    respond(id, { contentItems: [{ type: "inputText", text }], success: ok });

  try {
    if (tool === "media_preview") {
      const url = String(args.url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) reply(false, "需要一个 http(s) 视频地址（m3u8 或 mp4）。");
      return true;
      /* ⛔ 审查补充：只允许公网地址 —— 模型可被诱导传入内网/回环地址让播放器去加载。 */
      try {
        const host = new URL(url).hostname;
        const isPrivate = host === "localhost" || host === "0.0.0.0" || /^127\./.test(host) || /^10\./.test(host)
          || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
        if (isPrivate) reply(false, "不允许播放内网/本机地址（仅支持公网片源）。");
      return true;
      } catch { reply(false, "地址格式不合法。");
      return true; }
      const { sendToWindow } = await import("./features/window-bus");
      sendToWindow("media-preview:open", {
        source: url,
        kind: "video",
        title: String(args.title ?? "影视播放"),
        autoPlay: true,
      });
      reply(true, `已在对话播放器里起播${args.title ? `：${args.title}` : ""}。`);
      return true;
    }

    const media = await import("./media-sources");
    if (tool === "media_search") {
      const keyword = String(args.keyword ?? "").trim();
      if (!keyword) reply(false, "请给出片名关键词。");
      return true;
      /* ⛔ 契约对齐（审查发现）：MediaSearchInput 是 { query, sources, limit, timeoutMs }，
         传 keyword/page 会**永远搜不到东西且不报错**。 */
      const res: any = await (media as any).searchMediaSources({ query: keyword, limit: Number(args.limit ?? 8) });
      const items: any[] = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
      if (!items.length) reply(true, `没有搜到「${keyword}」。换个片名或换个源再试。`);
      return true;
      const lines = items.slice(0, 12).map((it: any, i: number) =>
        `${i + 1}. 《${it.vodName ?? it.name ?? "（无标题）"}》${it.vodRemarks ? ` · ${it.vodRemarks}` : ""}`
        + ` [源 ${it.sourceKey ?? it.source ?? "?"} · vodId ${it.vodId ?? it.id ?? "?"}]`);
      reply(true, `搜到 ${items.length} 条（取前 12）：\n${lines.join("\n")}\n\n要播哪一部？用 media_detail 取地址。`);
      return true;
    }

    // media_detail
    const sourceKey = String(args.sourceKey ?? "").trim();
    const vodId = String(args.vodId ?? "").trim();
    if (!sourceKey || !vodId) reply(false, "需要 sourceKey 与 vodId（来自 media_search 结果）。");
      return true;
    const detail: any = await (media as any).getMediaSourceDetail({ sourceKey, vodId });
    const groups: any[] = Array.isArray(detail?.groups) ? detail.groups : Array.isArray(detail?.playGroups) ? detail.playGroups : [];
    if (!groups.length) reply(true, "这个条目没有可播线路（可能是预告或源站已下架）。");
      return true;
    const head = groups.slice(0, 3).map((g: any) => {
      const eps: any[] = Array.isArray(g?.episodes) ? g.episodes : [];
      return `线路「${g?.label ?? "默认"}」：${eps.slice(0, 5).map((e: any) => `${e?.name ?? "第?"}集`).join("、")}${eps.length > 5 ? ` …共 ${eps.length}` : ""}`;
    });
    const firstUrl = String(groups[0]?.episodes?.[0]?.url ?? "");
    reply(true, `可用线路：\n${head.join("\n")}\n\n首条播放地址：${firstUrl || "（空）"}\n需要播放就调 media_preview(url=<上面这条>, title="<片名>")。`);
    return true;
  } catch (error: any) {
    reply(false, `影视工具执行失败：${String(error?.message ?? error).slice(0, 200)}`);
    return true;
  }
}
