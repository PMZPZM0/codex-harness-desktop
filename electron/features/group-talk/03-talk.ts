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
 * 护栏（防两个人互相 @ 到烧穿 token）：一轮总量 12 次投递、同一成员最多 3 次、
 * 同一 (发送者 → 接收者 + 内容) 只投一次、转手深度 ≤ 6。
 */
import { parseAgentMentions } from "../../../src/lib/team-models.mjs";
import { runTalkTurn, type TalkMember } from "./01-channel";
import { setGroupTalkHooks } from "./02-tools";

const MAX_DELIVERIES = 12;
const MAX_PER_MEMBER = 3;
const MAX_HOPS = 6;
const TURN_TIMEOUT_MS = Number(process.env.CODEX_GROUP_TALK_TIMEOUT_MS) > 0
  ? Number(process.env.CODEX_GROUP_TALK_TIMEOUT_MS)
  : 15 * 60 * 1000;

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

export type GroupTalkResult = { ok: boolean; sent: number; failed: string[]; hops: number };

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
    const speaker = String(row.speaker ?? "").trim() || "群成员";
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

async function withTimeout<T>(task: Promise<T>, name: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} 这一轮超过 ${Math.round(TURN_TIMEOUT_MS / 60000)} 分钟没回话`)), TURN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 群聊专属输入（⛔ 不复用 groupContextBlock —— 那是派活/协作协议的口径）。
 *  导出给接线层：群聊会话与互相投递共用同一份口径，⛔ 不写第二套。 */
export function buildTalkInput(options: GroupTalkOptions, me: TalkMember, from: TalkMember, text: string, history: TalkHistoryRow[] = []): string {
  const roster = options.roster.map((m) => `${m.name}${m.targetProfession ? `（${m.targetProfession}）` : ""}`).join("、");
  /* ⛔⛔ 11-07 真机：群聊会话是普通 thread，整段输入会被当成 userMessage 画进气泡 ——
     上一版把【工作伙伴 · X】+ 工具说明 + 指令全裸给用户看（截图）。
     ⇒ 用项目统一的 `[SYSTEM TASK · …]` 壳：user-refs.ts 只保留「=== 用户需求 ===」中间那段，
       壳前/壳后一律丢弃 ⇒ 气泡里只剩那句人话；模型仍然读得到完整指令。
     ⛔ 需求体第一行写发件人协议行（member · 名字），别让模型猜是谁在说话。 */
  const need = [
    "[SYSTEM TASK · 工作伙伴消息]",
    "=== 用户需求 ===",
    `发件人：member · ${sanitizeForEnvelope(from.name)}`,
    sanitizeForEnvelope(text),
    "=== END ===",
    "",
    /* ⛔ 群历史放**壳后**：气泡只显示上面那段需求体，模型却能读到整段共享上下文。 */
    groupHistoryBlock(history, text),
    `【工作伙伴 · ${options.groupName}】`,
    `你是 ${me.name}${me.targetProfession ? `（${me.targetProfession}）` : ""}。这里是群聊，不是任务派发：刚那句是群里有人说的话，按你的身份回一句就行。`,
    `群里的人：${roster || "（暂时只有你自己）"}`,
  ];
  if (options.memory) need.push(`群里的共享背景：${options.memory}`);
  need.push(
    "你手上有三个群聊工具：group_say（说话；填 to=名字 就是直接说给那个人，他会在群里回你）、group_read、group_members。",
    "",
    "回一句人话。想让别人接话就另起一行写 `@名字：你要说的话`，或调 group_say 填 to —— 宿主会把这句送进他的会话，他的回复会以他的署名进群。别写任务书、别列要求清单、别调任何调度工具。",
  );
  return need.join("\n");
}

/** 启动一轮群聊：先注册这个群的工具 hooks，再把第一句投递给被 @ 的人，之后自动接力。 */
export async function runGroupTalk(
  options: GroupTalkOptions,
  firstTargets: TalkMember[],
  firstText: string,
  firstFrom: TalkMember = { id: "local-user", name: "我" },
): Promise<GroupTalkResult> {
  const failed: string[] = [];
  const sentByMember = new Map<string, number>();
  const seen = new Set<string>();
  let deliveries = 0;
  let maxHop = 0;

  const rosterById = new Map(options.roster.map((m) => [m.id, m]));
  const rosterByName = new Map(options.roster.map((m) => [String(m.name).replace(/\s+/g, "").toLowerCase(), m]));

  const deliver = async (from: TalkMember, targets: TalkMember[], text: string, hop: number): Promise<void> => {
    if (hop > MAX_HOPS || deliveries >= MAX_DELIVERIES || !String(text ?? "").trim()) return;
    maxHop = Math.max(maxHop, hop);
    for (const target of targets) {
      if (deliveries >= MAX_DELIVERIES) break;
      const count = sentByMember.get(target.id) ?? 0;
      if (count >= MAX_PER_MEMBER) continue;
      const dedupe = `${from.id}>${target.id}:${String(text).slice(0, 80)}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      deliveries += 1;
      sentByMember.set(target.id, count + 1);
      try {
        /* ⛔ 每一跳都重读群日志：接力到第 2 个人时，前一位刚说的话已经落群了。 */
        const history = await options.readMessages(TALK_HISTORY_LIMIT).catch(() => [] as TalkHistoryRow[]);
        const res = await withTimeout(
          runTalkTurn(options.groupId, target, buildTalkInput(options, target, from, text, history), {
            cwd: options.cwd,
            effort: options.params?.effort,
          }),
          target.name,
        );
        const replyText = String(res.text ?? "").trim();
        if (replyText) {
          const wrote = await options.append({
            authorId: target.id,
            authorKind: "bot",
            senderKind: "member",
            threadId: res.threadId,
            text: replyText,
            via: { memberId: from.id, name: from.name },
          });
          if (!wrote.ok) failed.push(`${target.name}：${wrote.error || "回复没写进群"}`);
        }
        options.onMessage?.(target, replyText, true);
        if (!replyText) continue;
        /* 行首 @ ⇒ 把那句话原样送进对方会话（不是派任务）。 */
        const asks = parseAgentMentions(replyText, options.group, {
          excludeId: target.id,
          max: 3,
          catalog: Array.isArray(options.catalog) ? options.catalog : [],
        });
        const next: TalkMember[] = [];
        const nextText: string[] = [];
        for (const ask of asks) {
          const found = ask.target
            ? (rosterById.get(ask.memberId) ?? rosterByName.get(String(ask.name).replace(/\s+/g, "").toLowerCase()))
            : (rosterById.get(ask.memberId) ?? null);
          if (!found || found.id === target.id) continue;
          next.push(found);
          nextText.push(ask.ask);
        }
        /* ⛔ 不 await：先让这一句上屏，后面的人各自接着说（串行会让一个人卡住整条对话）。 */
        for (let i = 0; i < next.length; i += 1) {
          void deliver(target, [next[i]], nextText[i], hop + 1).catch((err: unknown) => {
            failed.push(`${next[i].name}：${err instanceof Error ? err.message : String(err)}`);
          });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        failed.push(`${target.name}：${reason}`);
        options.onMessage?.(target, "", false);
      }
    }
  };

  /* 工具 hooks：模型在会话里主动 `group_say(to=...)` 也从这里进同一条投递链。 */
  setGroupTalkHooks(options.groupId, {
    append: (gid, entry) => (String(gid) === options.groupId
      ? options.append(entry)
      : Promise.resolve({ ok: false, error: "群 id 不匹配" })),
    relay: (gid, fromId, toName, text) => {
      const to = rosterByName.get(String(toName).replace(/\s+/g, "").toLowerCase());
      if (!to) return Promise.resolve({ ok: false, error: `群里没有叫「${toName}」的人` });
      const from = rosterById.get(fromId) ?? { id: fromId, name: "群成员" };
      void deliver(from, [to], text, 1).catch(() => undefined);
      return Promise.resolve({ ok: true });
    },
    readMessages: (limit) => options.readMessages(limit),
    members: () => Promise.resolve(options.roster.map((m) => ({ id: m.id, name: m.name, profession: m.targetProfession }))),
  });

  try {
    await deliver(firstFrom, firstTargets, firstText, 0);
  } finally {
    /* ⛔ 一轮结束就摘 hook：不留一个指向旧 roster / 旧 append 的闭包。 */
    setGroupTalkHooks(options.groupId, null);
  }
  return { ok: failed.length < deliveries, sent: deliveries, failed, hops: maxHop };
}
