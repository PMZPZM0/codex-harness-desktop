/**
 * 工作伙伴 · 群聊会话的**专属工具**（11-07 用户令「工具配套更新来」）。
 *
 * ⛔ 这三个工具只挂给群聊通道建的会话（见 01-channel 的 thread/start），
 *    ⛔ 不进 `harness_tools` 网关、不进任何被调度会话 —— 外面那条调度链一行都不改。
 * 群聊会话不在渲染层「正在看着」的列表里，它的 `item/tool/call` 会被 filterForRenderer 裁掉
 * ⇒ 和 role_memory_save / harness_tools 一样，**必须由主进程直接应答**（attachGroupTalkEvents）。
 *
 * 身份硬闸：只认引擎下发的 `event.params.threadId` 反查群聊台账（01-channel.lookupGroupThread），
 * ⛔ 绝不使用模型在 args 里自报的群 id / 成员 id。
 */
import { lookupGroupThread } from "./01-channel";

export type GroupTalkHooks = {
  /** 往群里写一条消息（作者由板块自己给，⛔ 不信任模型） */
  append: (groupId: string, entry: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  /** 把一句话投递进另一位成员的会话（他会回话，回复以他的署名进群）。
   *  `fromName` = 台账里记的发送者名字：调用方名册里查不到 id 时用它兜底，
   *  ⛔ 别退化成「群成员」——被叫的人（和界面）要能看出到底是谁在说话。 */
  relay: (groupId: string, fromId: string, fromName: string, toName: string, text: string) => Promise<{ ok: boolean; error?: string }>;
  /** 读群里最近的消息 */
  readMessages: (limit: number) => Promise<{ speaker: string; text: string }[]>;
  /** 成员名册（含管理员 / 团内位置，11-10 让成员互相认识） */
  members: () => Promise<{ id: string; name: string; profession?: string; admin?: boolean; role?: string }[]>;
};

/* ⛔ 按群隔离：多个群可以同时聊天，一个群的 hooks 不能覆盖另一个群。 */
const hooksByGroup = new Map<string, GroupTalkHooks>();

/** 由群存储板块在启动一轮群聊时注入（⛔ 群聊板块不直接 import harness-team-ipc，避免成环）。 */
export function setGroupTalkHooks(groupId: string, next: GroupTalkHooks | null): void {
  const gid = String(groupId ?? "");
  if (!gid) return;
  if (next) hooksByGroup.set(gid, next);
  else hooksByGroup.delete(gid);
}

/** 引擎 `thread/start` 的 dynamicTools：三个工具一次挂齐（resume 时整份忽略，所以只在新建时给）。 */
export function buildGroupTalkTools(): unknown[] {
  return [
    {
      type: "function",
      name: "group_say",
      description:
        "在工作伙伴群里说话。填 to（成员名字）就是把这句话直接说给那个人，宿主会把它送进他的会话，"
        + "他会在群里回你；⛔ 不填 to 只有用户看得到，其他成员不会因此回你（想让谁接话必须填 to）。"
        + "这是沟通，不是派任务：想让谁做什么就直接说，不要写「任务/交付物/请给结论」那套。",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "你要说的话（一句话或几句话，别写成报告）" },
          to: { type: "string", description: "可选：直接说给哪位成员听，写他的名字；写「管理员」就是找这个群的管理员" },
        },
        required: ["text"],
      },
    },
    {
      type: "function",
      name: "group_read",
      description: "读群里最近的消息（默认 12 条）。想接上之前聊到哪了就先读一下。",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number", description: "最多读几条，1~50" } },
      },
    },
    {
      type: "function",
      name: "group_members",
      description: "看这个群里都有谁、谁是管理员、各自负责什么、谁属于哪个专家团（写 @ / to 之前先确认名字）。", 
      inputSchema: { type: "object", properties: {} },
    },
  ];
}

const parseArgs = (raw: unknown): Record<string, unknown> => {
  if (typeof raw === "string") {
    try { const v = JSON.parse(raw); return v && typeof v === "object" ? v as Record<string, unknown> : {}; } catch { return {}; }
  }
  return raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
};

const reply = (respond: (id: string | number, result: unknown) => void, id: string | number, text: string, ok: boolean) => {
  respond(id, { contentItems: [{ type: "inputText", text }], success: ok });
};

/**
 * 主进程事件流里应答群聊工具。返回 true = 已应答；false = 不是群聊工具，交回原流程。
 * ⛔ 由 `attachGroupTalkEvents()` 挂到 server.on("event")，不改 boot.ts 的既有分发。
 */
export async function handleGroupTalkToolCall(input: {
  event: { id?: string | number; method?: string; params?: any };
  respond: (id: string | number, result: unknown) => void;
}): Promise<boolean> {
  const { event, respond } = input;
  if (String(event?.method ?? "") !== "item/tool/call") return false;
  const tool = String(event?.params?.tool ?? "");
  if (!["group_say", "group_read", "group_members"].includes(tool)) return false;
  const id = event?.id;
  if (id === undefined || id === null) return false;

  const who = lookupGroupThread(String(event?.params?.threadId ?? ""));
  if (!who) return false;   /* 不是群聊通道的会话 ⇒ 别截胡 */
  const groupId = who.groupId;
  const hooks = hooksByGroup.get(groupId) ?? null;
  if (!hooks) {
    reply(respond, id, "这个群的通道还没接好，这句没发出去。", false);
    return true;
  }
  const args = parseArgs(event?.params?.arguments);

  if (tool === "group_members") {
    const list = await hooks.members().catch(() => []);
    reply(respond, id, list.length
      ? `群里的人：${list.map((m) => [m.name, m.role, m.profession, m.admin ? "管理员" : ""].filter(Boolean).map((x, i) => i === 0 ? x : `（${x}）`).join("")).join("、")}`
      : "这个群暂时只有你自己。", true);
    return true;
  }

  if (tool === "group_read") {
    const limit = Math.max(1, Math.min(50, Number(args.limit) || 12));
    const rows = await hooks.readMessages(limit).catch(() => []);
    reply(respond, id, rows.length
      ? rows.map((r) => `${r.speaker}：${r.text}`).join("\n")
      : "群里还没有消息。", true);
    return true;
  }

  /* group_say */
  const text = String(args.text ?? "").trim();
  if (!text) {
    reply(respond, id, "没写内容，这句没发出去。", false);
    return true;
  }
  const to = String(args.to ?? "").trim();
  const wrote = await hooks.append(groupId, {
    authorId: who.memberId,
    authorKind: "bot",
    senderKind: "member",
    threadId: String(event?.params?.threadId ?? ""),
    text,
    ...(to ? { to } : {}),
  }).catch((err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  if (!wrote.ok) {
    reply(respond, id, `没发出去：${wrote.error || "群消息没存上"}`, false);
    return true;
  }
  if (to) {
    const relayed = await hooks.relay(groupId, who.memberId, who.name, to, text)
      .catch((err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    reply(respond, id, relayed.ok
      ? `已经把这句说给 ${to} 了，他会在群里回你。`
      : `这句已经发到群里，但没送到 ${to}：${relayed.error || "没找到这个人"}`, relayed.ok);
  } else {
    reply(respond, id, "已经发到群里了。", true);
  }
  return true;
}

/** 在群聊板块的 feature 里订阅（⛔ 不碰 boot.ts 的既有 handler 顺序）。 */
export function attachGroupTalkEvents(serverLike: { on: (name: string, fn: (event: any) => void) => void; off?: (name: string, fn: (event: any) => void) => void; respond: (id: any, result: unknown) => void }): () => void {
  const fn = (event: any) => {
    void handleGroupTalkToolCall({ event, respond: (reqId, result) => serverLike.respond(reqId, result) }).catch(() => false);
  };
  serverLike.on("event", fn);
  return () => { serverLike.off?.("event", fn); };
}
