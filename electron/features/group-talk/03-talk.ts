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
  /* ⛔ 11-10 用户令「专家群 / 专家团群 / CLI 群各定制一套记忆」：
     这一段由 `memory/group-memory-inject` 按**群类型 + 座位**生成（团群给团级规则优先、
     平级专家群把冲突摆出来、CLI 群只给纯文本片段），本函数只负责拼，⛔ 不在这里再判一次群类型。 */
  groupMemory?: string | null,
  /* ⛔ 11-10 用户令「私聊就是那个来源对话」：把**你名下的待处理**注入到你自己的会话里 ——
     这就是"私聊触达"的等价物：它一开口就看到自己欠什么，不用额外起一个回合（不烧钱）。
     ⛔ 由调用方按任务账本算出（toId = 本成员 且 status = open），这里只管渲染。 */
  pendingDuties?: Array<{ title: string; fromName: string; at?: number }> | null,
): string {
  /* ⛔ 11-08 审查确认：成员名 / 群名 / 共享背景同样是外部可改文本，进信封前一律消毒
     （与正文同口径 —— 名字里塞结束标记同样能让剥离器提前截断）。 */
  /* ⛔⛔ 11-10 用户：「成员都不知道哪个是管理员，成员都互相不认识」。
     原来名册只有「名字（职业）」⇒ 成员看不出谁负责推进进度、谁属于哪个团。
     ⇒ 把管理员 / 团内位置一起拼进名册（与 UI 标签、group_members 同一份下发数据）。 */
  const roster = options.roster.map((m) => {
    const tags = [m.targetProfession, m.teamRole === "lead" ? "团主理人" : m.teamRole === "member" ? "团成员" : "", m.isAdmin ? "管理员" : ""]
      .filter(Boolean).map((t) => `（${sanitizeForEnvelope(String(t))}）`).join("");
    return sanitizeForEnvelope(m.name) + tags;
  }).join("、");
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
    /* ⛔⛔ 11-10 用户（截图）：「群成员连自己是谁都不知道」。
       实测：群里只有一个「内容创作专家团」槽，UI 展开成 6 个人名；用户 @文枢 派活，
       投过去的是**团名** ⇒ 它回「这条流程是文枢的活，我不抢，在群里等派单」——
       把自己当成了旁观者，整条链一个人都不动。
       ⇒ 团主理人用**它自己的名字**做身份，并把「用户 @你就是在叫你」写死。 */
    ...(() => {
      const leadAsSelf = me.teamRole === "lead" && Boolean(me.teamLeadName);
      const selfName = leadAsSelf ? String(me.teamLeadName) : sanitizeForEnvelope(me.name);
      const selfProf = leadAsSelf ? String(me.teamLeadProfession ?? "") : String(me.targetProfession ?? "");
      const lines = [`你是 ${sanitizeForEnvelope(selfName)}${selfProf ? `（${sanitizeForEnvelope(selfProf)}）` : ""}。`];
      if (leadAsSelf) {
        lines.push(
          `群里的人只按名字认识你：用户写「@${sanitizeForEnvelope(selfName)}」就是在叫你，不是在叫别人。`
            + `⛔ 别把自己当旁观者，也不要说"这是 ${sanitizeForEnvelope(selfName)} 的活"——那就是你的活。`,
          `你是「${sanitizeForEnvelope(String(me.teamName ?? ""))}」的主理人：这个团谁做什么、做完验收、什么时候收口，都由你主持。`,
          /* ⛔⛔ 11-12 用户：「管理员设置就不能再展示普通标了」「管理员设置后多了哪些工具联动」。
             管理员是**群级身份**：团群的管理员就是主理人 —— 它要在行为上（不只是标签上）按管理员来：
             没人 @ 时它接话，它决定谁做、先做什么。 */
          "你是这个群的**管理员**：用户不 @ 任何人时就是在找你；由你判断这一轮谁做、先做什么（⛔ 别问用户该派谁）。",
        );
      }
      lines.push("这里是群聊：刚那句是群里有人说的。是交给你的事就直接干（或派给该干的人），⛔ 不要只回一句「收到」就停在那里。");
      return lines;
    })(),
    `群里的人：${roster || "（暂时只有你自己）"}`,
    /* ⛔ 11-10：把「谁推进进度」写死，别让成员凭名字猜。 */
    ...(() => {
      /* ⛔ 11-12：团群不设 adminId，管理员就是主理人 ⇒ 这里兜一层，名册/分工文案才不会漏掉它。 */
      const admin = options.roster.find((m) => m.isAdmin)
        ?? (me.teamRole === "lead" && me.teamLeadName ? { name: String(me.teamLeadName), isAdmin: true } : undefined);
      return admin ? [`【群里的分工】${sanitizeForEnvelope(admin.name)} 是这个群的管理员：用户没 @ 任何人时由它接话推进进度。想找它就直接另起一行写 @${sanitizeForEnvelope(admin.name)}：…，或调 group_say 填 to="管理员"。不确定谁负责什么，先调 group_members 看名册。`] : [];
    })(),
    /* ⛔⛔ 11-10 用户令「让主理人自己排下一轮」：宿主能做的只有"按它说的顺序执行"，
       所以这里必须让它**一次说清整轮排片**，而不是每次只说一个人、被事件一个个叫回来。 */
    ...((me.isAdmin === true || me.teamRole === "lead")
      ? ["【你是主持人】每一轮请一次说清：这一轮派给谁、要他做什么 —— 可以一次 @ 多人，宿主会按你写的顺序依次执行（前一个做完再叫下一个）。没人可派就自己把这一段讲完；整件事有结论时，最后一行写「收口」，宿主就不再拉人。",
        "⛔ 用户已经把活交过来了：第一轮就要开始派（或自己先做第一步），⛔ 不要回一句「收到，我等你派单」——群里没有第二个人会替你派单。"]
      : []),
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
  /* ⛔ 11-10 用户令「团队要像团队」：每个人得知道向谁汇报 —— 否则卡住只会沉默或乱拉人。 */
  if (me.managerName) {
    need.push(
      `你的直属上级是 ${sanitizeForEnvelope(String(me.managerName))}：卡住、要不到输入、或判断影响面大时，先向它说明再做；它派的活优先于别人临时叫你。`,
    );
  }
  /* ⛔ 11-10 用户令「继续补上缺口」：实测豆包是「群里发总榜 + 点名到人」。
     我们这边没有私聊载体，真正的缺口是**异常发在群里没人认领** + **说"做完了"没有凭据**。 */
  need.push(
    "【异常必须落到人】报问题 / 异常 / 需要别人动手的事时，**单独一行**写：`【待处理 · 责任人：某人】`"
      + "（某人是群里的人名，或「用户」）。宿主会把它记成一条待办，群头能看到「还欠谁一件事」，对方开口后自动关闭。"
      + "⛔ 只说「有异常」不写责任人 = 这条没人接，等于没说。",
    "【交付要自证】说「做完了 / 修好了 / 验过了」必须带可核对的东西：改了哪个文件、验过哪几个入口、关键数字的前后对照。"
      + "⛔ 不要只说「已完成」—— 没有凭据的完成，下次还要重查一遍。",
  );
  /* ⛔⛔ 11-11：这段原来是**一句条件句**（"如果本会话能调 harness_tools 就…"）——
     而群聊会话根本没挂那个网关 ⇒ 群里永远走 else，等于给了一条永远不成立的指令。
     ⇒ 按事实分两套：拿到网关的（团群主理人）真的能建；没拿到的（成员 / 普通群）明说该交给谁。
     ⛔ 判据只看 `me.harnessGateway`（调用方按"工具面真挂上了"给），⛔ 不在这里猜群类型。 */
  need.push(...(me.harnessGateway
    ? [
        "【你可以自己排节奏】有件事需要按天/按点重复做，就用 `harness_tools` 调 `scheduler_save`"
          + "（`threadId` 传 \"current\"）建定时任务：写清任务名、什么时候做、**派给谁**（assignee）、"
          + "**依赖谁的产出**（dependsOn）。⛔ 只建真正需要重复的；一次性能做完的直接做。",
      ]
    : [
        "【定时任务不在你这儿建】本会话调不到 `harness_tools`：需要定期跑的事，就在回复里写清"
          + "「多久一次 / 做什么 / 派给谁」，让用户去「设置 → 自动化」建。⛔ 别说「我已经建好了」。",
      ]));
  /* ⛔ 11-10 用户令「文件里能看的东西最全」⇒ 产物必须可归档、可回溯（实测豆包那种 261108-短名 目录）。
     只给约定不强制路径：会话工作区由宿主决定，模型按约定建子目录。 */
  if (options.cwd) {
    need.push(
      "【产物落盘】做完的东西放 `artifacts/YYYYMMDD-<任务短名>/`（例：`artifacts/20261110-推广汇报/daily-1107.png`）。",
      "文件名写**内容语义**（daily-1107 / owner-fix / cat-top10），不要 a1.png、未命名.png；同一份东西多版用后缀区分（-r1 / -r2 / -low / -final）。",
      "⛔ 别把产物散在目录根下：一周后谁也认不出哪个文件是哪次任务的。",
    );
  }
  if (pendingDuties && pendingDuties.length) {
    const rows = pendingDuties.slice(0, 5).map((d) => {
      const when = d.at ? new Date(d.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
      return `- ${sanitizeForEnvelope(String(d.title))}${d.fromName ? `（${sanitizeForEnvelope(String(d.fromName))} 提的${when ? ` ${when}` : ""}）` : ""}`;
    });
    need.push(
      `【你名下的待处理（${pendingDuties.length} 条）】`,
      ...rows,
      "⛔ 这些是别人点名等你处理的：先处理它们再说别的；处理完在群里说清结果（带凭据）。",
    );
  }
  /* 群记忆块（索引 + 本轮召回）：与共享背景分开推 —— 它带自己的标题与规则行，
     混进「共享背景」里会被当成人写的一段说明，模型就不当记忆用了。 */
  if (groupMemory) need.push(sanitizeForEnvelope(String(groupMemory)));
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
    /* ⛔ 11-12：group_say(to=) 的语义是**真的把活交给他**（relay 会把话送进他的会话、他跑一个完整回合、
       产出以他的署名发进群），不是"群里说一句"。旧文案写"他会在群里回你"+「别写任务书」，
       主理人于是只把任务书写进正文、一个 to 都不填 —— 用户看到的就是"派了没人干"。 */
    "你手上有三个群聊工具：group_say（说话；填 to=名字 就是**把这件事交给他做** —— 他真的会动手，结果以自己的署名发进群；写 to=「管理员」就是找管理员；不填 to 只有用户看得到、其他成员不会被叫醒）、group_read（读最近消息）、group_members（看名册：谁是管理员、各自负责什么、谁属于哪个团）。",
    "",
    "回一句人话。⛔ 说话方式二选一：要么直接写进这条回复（宿主会把它发进群），要么调 group_say；不要两样都做——群里会出现两条一样的。闲聊别写任务书、别列要求清单；⛔ 但真要派活时必须写清要他做什么、交什么。",
    /* ⛔⛔ 11-11 用户令（「群聊会话仍然拿不到 team_member_invoke，主理人还是靠行首 @名字：派活」）：
       团群主理人的会话现在挂了**真的**调度工具 ⇒ 这段说明必须跟着换，否则它还按旧话术
       「别调任何调度工具」+ 行首 @ 演戏。⛔ 只在调用方确认它拿到了这批工具时才出现。 */
    ...(Array.isArray(me.dispatchTools) && me.dispatchTools.length
      ? [
          `你还有**真正的团队调度工具**：${me.dispatchTools.join(" / ")}。派活就用它们 —— ⛔ 别再用行首「@名字：」假装派活，那只是群里说了一句话，成员不会真的被拉起来干活。`,
          " · 同一阶段多人并行：一次 team_phase_invoke(tasks) 提交，宿主并发跑，产出各自进群；",
          " · 单个成员、或后一环依赖前一环：team_member_invoke(memberId, query)，写清「输入 / 交付物 / 交给谁」；",
          " · 成员会真的在自己的会话里干完，结果以他的署名发进群，你只做验收和汇总。",
          /* ⛔⛔ 11-12 真机（用户建的群是逐个拉人：主理人属增长团、显影/析毫/察势属数据团）：
             `team_member_invoke` 只能派**本团**成员（执行端按 teamId 校验），拿它派别的团的人
             会报「成员不存在于专家团」。所以跨团成员必须走 group_say(to=名字) —— 那条链同样是
             真的把话送进他的会话、他跑完整回合、产出进群。⛔ 别让模型在错误的工具上撞墙。 */
          " · 群里**不属于你团的**成员（名册里标着别的团）：用 group_say(to=名字) 派 —— 那是真的把活交给他、他会在群里交付；⛔ team_member_invoke 只能派本团成员。",
          /* ⛔⛔ 11-11 群聊改异步排片：工具**立刻**回「已派单」，成员在后台跑。
             这句口径必须跟着换 —— 原来写「会等成员真干完才返回」，模型就会在拿到已派单后
             以为活干完了，直接写「收口」或把同一批人再派一遍。 */
          "⛔ 群里这两种调用是**异步排片**：工具立刻回「已派单」，成员在后台跑、产出以他的署名发进群。",
          /* ⛔⛔ 11-12 用户（截图 + 「就正常对话聊天派活」「狗屁不通的设计」）：
             用户只说了句「给你团队丢点活，我看看跑任务效果」，主理人**自己拟了一个题目**、
             自己拆成 4 个环节、一次派给 4 个人 —— 用户要的是正常对话派活，不是它自作主张。
             ⇒ 没有明确任务就先问，别自己发明活。 */
          "⛔⛔ 用户没给出**具体任务**时（寒暄、试试效果、只说了方向），先问一句「要做什么」，不要自己拟定题目 / 自己拆环节 / 自己派人。",
          "  · 用户给了具体任务：按需要派 1 个人就够，别为了显得热闹拆成四五个环节；只有确实需要多人分工才并行。",
          /* ⛔⛔ 11-12 用户：「如果还要我指定让他派哪个人干嘛，那就是废物，自己成员都不了解？」 */
          "  · **派谁由你自己判断**：先看团队成员名册（名字 / 职业 / 擅长），按各自擅长决定；⛔ 不许问用户「要派给谁」，也不许让用户替你想分工。",
          /* ⛔⛔ 11-12 用户：「主代理一直刷屏」。原话术让它在拿到已派单后再回
             「已派给谁、在等什么」= 同一件事说两遍（派单消息已经进群了）。⇒ 这一轮**闭嘴**。 */
          "  · 拿到「已派单」就**不要再说话**（不要复述派给谁、不要报进度）——派单消息已经进群，用户看得见。",
          "  · 成员全部交回后，宿主会把产出交回给你，那时再验收 / 推进下一阶段 / 收口。",
        ]
      : ["⛔ 别调任何调度工具。"]),
  );
  return need.join("\n");
}
