/**
 * 工作伙伴 · 群聊消息投递与互相沟通（11-07 用户令：「群聊的会话，必须要有相互沟通权限，
 * 不是调度，是互相沟通」）。
 *
 * ⛔ 这里做的是**消息投递**，不是派活：
 *   · 一条群消息 = 送进某位成员长期会话的一轮输入；
 *   · 它的最终文本 = 以**它自己的署名**写回群日志；
 *   · 它想跟谁说话 ⇒ 行首 `@名字：话` 或工具 `group_say(to=名字)` ⇒ 宿主把这句**原样**
 *     投递进对方的会话，对方回话，形成对话链。
 *   ⛔ 全程没有 `runDelegatedTask` / `delegateRegistry` / 上级-下级 / 交付物模板 / 结论-依据-建议。
 *
 * ⛔⛔ 11-08 审查：这里原来还放着 runGroupTalk（整段投递/接力链），但派活搬进主进程后
 *   已经**没有任何调用方**（真链是 harness-team-ipc 的 talk 处理器）—— 两套投递口径并存只会漂。
 *   已删除；本文件只保留**共享上下文纯函数**（buildTalkInput / groupHistoryBlock / sanitizeForEnvelope）。
 */
import { type TalkMember } from "./01-channel";
/* ⛔ 团队协作口径只有这一份（主理人通道 `team-invoke` 用的也是它）—— 群里复用，不写第二套。 */
import { collaborationProtocolLines } from "../../../src/lib/team-models.mjs";

type AppendEntry = Record<string, unknown>;
type Append = (entry: AppendEntry) => Promise<{ ok: boolean; error?: string }>;

export type GroupTalkOptions = {
  groupId: string;
  groupName: string;
  cwd?: string;
  memory?: string;
  /** 群成员 + 展开的团成员（合成 id），每人都会拿到一条长期会话 */
  roster: TalkMember[];
  /** 原始群对象（parseAgentMentions 判据） */
  group: Record<string, unknown>;
  catalog?: unknown[];
  params?: { effort?: string };
  append: Append;
  readMessages: (limit: number) => Promise<{ speaker: string; text: string }[]>;
  onMessage?: (member: TalkMember, text: string, ok: boolean) => void;
};

/* ══════ 群会话共享上下文（11-08 用户问「群成员，都能看到群会话内容吗」）══════
   现状：每位成员只拿到「当前这一句 + 名册 + 群简介」，历史消息**不注入**，只能靠模型
   主动调 group_read 读 12 条 ⇒ 别人之间没 @ 它的对话它一概看不见，接不上话。
   ⇒ 默认把群里最近 N 条注入**每一轮**（不是只给第一个人）：每位成员拿到同一份共享上下文。

   ⛔ 放置位置有两条硬约束（改动前先读这两处）：
     ① 必须在 `[SYSTEM TASK · …]` 壳的 `=== END ===` **之后**：user-refs.ts 解析时只保留
        「=== 用户需求 === … === END ===」中间那段 ⇒ 气泡里仍只有那一句人话，历史不会糊到界面上；
        而模型读的是整段输入，照样看得到。
     ② 必须用 `【群聊上下文 · …】…【群聊上下文结束】` 信封：harness-block-strip.mjs /
        cloud-sync.ts / memory-lessons.ts / thread-backup.ts 四处都按它剥离
        ⇒ 历史不会漏进会话标题、云同步正文、记忆归档与备份。⛔ 改一个字就四处全漏。
   ⛔ 同时保留 group_read：默认给最近 20 条，更早的由模型自己调工具取（不重复造轮子）。 */
export const TALK_HISTORY_LIMIT = 20;
const TALK_HISTORY_CHAR_MAX = 400;
const TALK_HISTORY_TOTAL_MAX = 8000;

export type TalkHistoryRow = { speaker: string; text: string };

/**
 * 群消息原文进入宿主信封前的消毒（11-08 审查）。
 * ⛔ 四处剥离器（harness-block-strip / cloud-sync / memory-lessons / thread-backup）按
 *   `【群聊上下文结束】`、行首 `---`、`=== END ===` 截断 —— 消息正文里带上这些标记，
 *   信封会被**提前截断**：后半段（含宿主指令）漏进云同步/记忆/备份，还能被伪造成系统指令。
 * 中和方式：插零宽空格 / 把标记等号换成全角 —— 用户看到的字面几乎不变。
 */
export function sanitizeForEnvelope(text: string): string {
  return String(text ?? "")
    .replace(/【群聊上下文/g, "【群聊上下文\u200b")
    .replace(/^([ \t]*)(-{3,})/gm, "$1\u200b$2")
    .replace(/(={3,})(\s*(?:用户需求|END|本次任务[^\n=]*)\s*)(={3,})/g, "＝$2＝");
}

/** 纯函数：群日志 → 共享上下文块。⛔ 只做格式化与裁剪，不读盘（谁都能复用）。 */
export function groupHistoryBlock(rows: TalkHistoryRow[], currentLine = ""): string {
  const picked: string[] = [];
  let used = 0;
  const current = sanitizeForEnvelope(String(currentLine ?? "").replace(/\s+/g, " ").trim());
  const recent = (rows ?? []).slice(-TALK_HISTORY_LIMIT);
  /* ⛔⛔ 11-08 Code review 抓到真缺陷：原先按时间**正序**累加、超预算就 break，
     丢掉的永远是**最新**那几条（实测 20 条各 400 字时第 19 条被丢、第 0 条保留）——
     与「让成员接上话」的目标正好相反。⇒ 从最新往旧累加，预算不够时丢最旧的，最后反转回正序。 */
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const row = recent[i];
    if (!row) continue;
    const text = sanitizeForEnvelope(String(row.text ?? "").replace(/\s+/g, " ").trim());
    if (!text) continue;
    /* 本轮这句已在需求体里给过一次，别在历史里再贴一遍（模型会以为要回两次）。 */
    if (text === current) continue;
    /* ⛔ 11-08 审查确认：说话人名字是用户可改的，同样能带信封结束标记 ⇒ 一起消毒
       （否则一条名叫「【群聊上下文结束】」的成员会让剥离器提前截断、后面的系统指令漏掉）。 */
    const speaker = sanitizeForEnvelope(String(row.speaker ?? "").trim()) || "群成员";
    const line = `${speaker}：${text.slice(0, TALK_HISTORY_CHAR_MAX)}`;
    if (used + line.length > TALK_HISTORY_TOTAL_MAX) break;
    picked.push(line);
    used += line.length;
  }
  if (!picked.length) return "";
  picked.reverse();
  return [
    "【群聊上下文 · 群里最近的消息】",
    `下面是群里最近 ${picked.length} 条对话，所有成员都能看到。别把别人的话当成对你说的，只接跟你有关的那句；想看更早的用 group_read。`,
    ...picked,
    "【群聊上下文结束】",
    "",
  ].join("\n");
}

/** 群聊专属输入（⛔ 不复用 groupContextBlock —— 那是派活/协作协议的口径）。
 *  导出给接线层：群聊会话与互相投递共用同一份口径，⛔ 不写第二套。 */
export function buildTalkInput(
  options: GroupTalkOptions,
  me: TalkMember,
  from: TalkMember,
  text: string,
  history: TalkHistoryRow[] = [],
  /* ⛔⛔ 11-09 用户：「里面的 agent 必须知道自己在话题里面」「在话题里面，重要的消息也可以在外面汇报」。
     ⇒ 话题内派活时把话题起点带进来，并在 prompt 里明说「你在话题里」+ 一条跳出话题的约定写法。
     ⛔ 只加在**壳后**（模型读得到、气泡不显示）；⛔ 不改正文、不改落盘结构。 */
  topic?: { rootText?: string } | null,
): string {
  /* ⛔ 11-08 审查确认：成员名 / 群名 / 共享背景同样是外部可改文本，进信封前一律消毒
     （与正文同口径 —— 名字里塞结束标记同样能让剥离器提前截断）。 */
  const roster = options.roster.map((m) => sanitizeForEnvelope(`${m.name}${m.targetProfession ? `（${m.targetProfession}）` : ""}`)).join("、");
  /* ⛔⛔ 11-07 真机：群聊会话是普通 thread，整段输入会被当成 userMessage 画进气泡 ——
     上一版把【工作伙伴 · X】+ 工具说明 + 指令全裸给用户看（截图）。
     ⇒ 用项目统一的 `[SYSTEM TASK · …]` 壳：user-refs.ts 只保留「=== 用户需求 ===」中间那段，
       壳前/壳后一律丢弃 ⇒ 气泡里只剩那句人话；模型仍然读得到完整指令。
     ⛔ 需求体第一行写发件人协议行（member · 名字），别让模型猜是谁在说话。 */
  /* ⛔ 11-08 用户问「群里超长上下文怎么办」：这条消息本身也要封顶 ——
     成员之间投递的是对方模型的长输出，不截断时单条就能把接收方会话撑爆。
     （历史注入另有 400 字/条 + 8000 字总预算，见 groupHistoryBlock。） */
  const body = (() => {
    const clean = sanitizeForEnvelope(text);
    return clean.length > 8000 ? `${clean.slice(0, 8000)}\n…（消息过长，已截断；需要全文让对方重发）` : clean;
  })();
  const need = [
    "[SYSTEM TASK · 工作伙伴消息]",
    "=== 用户需求 ===",
    `发件人：member · ${sanitizeForEnvelope(from.name)}`,
    body,
    "=== END ===",
    "",
    /* ⛔ 群历史放**壳后**：气泡只显示上面那段需求体，模型却能读到整段共享上下文。 */
    groupHistoryBlock(history, text),
    `【工作伙伴 · ${sanitizeForEnvelope(options.groupName)}】`,
    `你是 ${sanitizeForEnvelope(me.name)}${me.targetProfession ? `（${sanitizeForEnvelope(me.targetProfession)}）` : ""}。这里是群聊，不是任务派发：刚那句是群里有人说的话，按你的身份回一句就行。`,
    `群里的人：${roster || "（暂时只有你自己）"}`,
  ];
  /* ⛔⛔ 11-09 用户：「让团队真正运作起来，更像一个开箱即用的成熟团队，不需要用户再调教」。
     被 @ 到的若是专家团，它得知道**自己站哪一环**，否则只能凭职业名瞎猜：
       · 主理人要知道自己负责拆解/分工/验收/汇总（不是自己上去写）；
       · 团成员要知道自己只管这一环、缺输入先要、别越界。
     口径直接复用 `collaborationProtocolLines`（与团主理人通道同一份），⛔ 不另写规则。 */
  if (me.teamName && me.teamRole) {
    const seat = me.teamRole === "lead" ? "你是这个团的主理人" : "你是这个团的成员";
    need.push(
      `【你在团队里的位置】你属于「${sanitizeForEnvelope(me.teamName)}」，${seat}。`
        + (me.teamPeers?.length ? `同团：${me.teamPeers.map((n) => sanitizeForEnvelope(n)).join("、")}。` : ""),
    );
    need.push(...collaborationProtocolLines(me.teamRole));
  }
  if (options.memory) need.push(`群里的共享背景：${sanitizeForEnvelope(String(options.memory))}`);
  if (topic) {
    /* ⛔ 话题 = 迷你群聊（11-09 用户定稿）：一句一句接着聊，**默认留在话题里**（不铺到群主流）；
       只有「对全群都重要」的内容才额外汇报出去 —— 否则主流会被话题里的碎话刷满。 */
    const root = sanitizeForEnvelope(String(topic.rootText ?? "")).replace(/\s+/g, " ").trim().slice(0, 240);
    need.push(
      "【你正在一个话题里回复】",
      "这是群里的一个**话题**（一段围绕同一件事的连续对话），不是群主流。你这条回复会留在话题里，群里的人点开话题才看到 —— 这是正确的、不要因此重复发。",
      root ? `话题起点：${root}` : "",
      "如果这条内容对**全群**都重要（结论 / 决定 / 状态变了 / 需要所有人都知道的进展），在回复里**单独一行**写 `【群里汇报】你要说的那句`，宿主会把这一行额外发到群主流；其余内容照旧留在话题里。",
      "⛔ 不要为了「让更多人看到」而把整段回复复制两份。",
    );
  }
  need.push(
    /* ⛔⛔ 11-08 用户实测（截图：成员回「生图专家 哈喽~」但没 @，对方一直不吭声）：
       「好家伙，他们都不知道沟通要互相 @ 才行」——协议原来只写在最后一句里，模型写名字
       不带 @ 就以为对方收到了。⇒ 提成独立小段、放工具说明**之前**，并把失败模式写死。 */
    "【群聊沟通协议 · 必须遵守】在群里想让某位成员看到并回你，只有两种写法：",
    "  ① 正文里**另起一行、行首**写 `@名字：你要说的话`（例：`@生图专家：麻烦画一张封面`）；",
    "  ② 调工具 `group_say` 并填 `to=名字`。",
    "用这两种写法，宿主会把这句送进他的会话，他的回复会以他的署名进群。",
    "⛔ 只在句子里提到名字不算（例：`生图专家 你好`）—— 对方**收不到、也不会回你**；必须带 `@` 和冒号（全角半角都行），或走 group_say 的 to。",
    "打招呼、转达、提问、协作全都适用：用户让你「跟某某打个招呼」时，同样要 @ 他。",
    /* ⛔⛔ 11-09 用户问「都知道什么时候回复不用艾特、什么时候需要艾特吧」——
       原来只有**正向**规则（要 @ 才收得到），没有**反向**规则 ⇒ 模型容易把所有人都点一遍。
       ⇒ 把「什么时候闭嘴 / 什么时候别 @」也写死，这是"成熟团队"和"吵成一团"的分界。 */
    "【什么时候别说话 / 别 @ · 同样要遵守】",
    "  · 只接**点到你**的那句：@ 了你、或问的正是你这一块。别人的闲聊、别人的活，不用插话刷存在。",
    "  · 只是汇报、给结论、答用户：**不要 @ 任何人** —— 每 @ 一次都会真的把人叫起来干一轮（费时费钱）。",
    "  · 一行最多 @ 一个人；要同时找几个人，就分别另起一行写（`@甲：…` 换行 `@乙：…`），别堆在一句里。",
    "  · 别重复别人的结论；你已经说过的不再说第二遍。",
    "",
    "你手上有三个群聊工具：group_say（说话；填 to=名字 就是直接说给那个人，他会在群里回你；不填 to 只有用户看得到、其他成员不会因此回你）、group_read、group_members。",
    "",
    "回一句人话。⛔ 说话方式二选一：要么直接写进这条回复（宿主会把它发进群），要么调 group_say；不要两样都做——群里会出现两条一样的。别写任务书、别列要求清单、别调任何调度工具。",
  );
  return need.join("\n");
}
