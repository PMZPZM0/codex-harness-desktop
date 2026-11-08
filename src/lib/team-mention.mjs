/**
 * 团队模式 · @ 提及口径（纯函数，可单测）
 *
 * 11-07 用户令：输入框上方那一排「本轮 @」常驻 chip 改成 **@ 候选面板**（飞书 §4：
 * 机器人是单独一类候选）。面板要能「打字触发 + 搜索 + 分类 + 多选」，所以判定规则必须
 * 抽成纯函数（渲染层只负责画）：
 *   ① 什么时候算触发（`@` 前必须是行首 / 空白 / 中文标点，否则 `a@b`、`C:\x@y` 会误触发）；
 *   ② 当前查询词是什么（词里不许再出现 `@` 或空白，最长 40 字，caret 越界按末尾处理）；
 *   ③ 选人后怎么替换文本（把 `@查询词` 换成 `@名字 `，caret 落到空格后）。
 *
 * ⛔ 这里不做 IPC / 不读 DOM / 不 import React；候选分类只吃 `group.members` + 调度目录。
 */

/* 团成员的 @ 目标是**成员本人**（合成 id），编解码只认 team-models 一处（⛔ 别在这里手拼字符串）。 */
import { teamAuthorIdOf, teamMemberIdOf } from "./team-models.mjs";

/** 允许出现在 `@` 前面的中文标点（与用户口径一致：中文标点后可以接 @，ASCII 冒号/反斜杠不行）。 */
const CN_PUNCT = "，。！？；：、（）【】《》“”‘’〈〉「」『』…—·";

/** 查询词上限（用户口径：最长 40 字）。 */
export const MENTION_MAX_QUERY = 40;

/**
 * 光标处是否处于一个 `@` 提及中。
 * @param text 整段输入
 * @param caret 光标位置（可越界：负数按 0、超长按末尾）
 * @returns { start, caret, query } | null；start = `@` 的索引
 */
export function mentionTriggerOf(text, caret) {
  const src = String(text ?? "");
  const raw = Number(caret);
  const pos = Number.isFinite(raw) ? Math.max(0, Math.min(src.length, Math.trunc(raw))) : src.length;

  let at = -1;
  for (let i = pos - 1; i >= 0; i -= 1) {
    const ch = src[i];
    if (ch === "@") { at = i; break; }
    /* 词里出现空白 ⇒ 这个 @ 已经"说完了"，光标不在提及里 */
    if (/\s/.test(ch)) return null;
  }
  if (at < 0) return null;

  const query = src.slice(at + 1, pos);
  if (query.length > MENTION_MAX_QUERY) return null;
  if (query.includes("@")) return null;
  if (/\s/.test(query)) return null;

  /* 边界：行首 / 空白 / 中文标点。⛔ ASCII 标点不放行（`a@b`、`C:\x@y`、`foo@bar.com` 都不是提及）。 */
  const before = at > 0 ? src[at - 1] : "";
  if (before && !(/\s/.test(before) || CN_PUNCT.includes(before))) return null;

  return { start: at, caret: pos, query };
}

/**
 * 候选匹配：名字优先（前缀 > 包含），其次职业/角色包含查询词。
 * ⛔ 保持传入顺序作为同分次序（分类内的原始顺序是产品顺序，不按字母重排）。
 * @param items 任意带 name/role 的对象数组
 * @param query 查询词（空 = 全量）
 * @param limit 最多返回几条（默认 8）
 */
export function matchMentionCandidates(items, query, limit = 8) {
  const q = String(query ?? "").trim().toLowerCase();
  const list = Array.isArray(items) ? items : [];
  const scored = [];
  list.forEach((item, index) => {
    const name = String(item?.name ?? "");
    if (!name) return;
    const role = String(item?.role ?? "");
    let score = -1;
    if (!q) score = 0;
    else if (name.toLowerCase().startsWith(q)) score = 3;
    else if (name.toLowerCase().includes(q)) score = 2;
    else if (role.toLowerCase().includes(q)) score = 1;
    if (score < 0) return;
    scored.push({ item, score, index });
  });
  /* 同分时短名字优先（搜「洞」先出「洞明」，再出「洞见 · 逆向工程专家」），再按原顺序。 */
  scored.sort((a, b) => b.score - a.score
    || String(a.item?.name ?? "").length - String(b.item?.name ?? "").length
    || a.index - b.index);
  return scored.slice(0, Math.max(1, Number(limit) || 8)).map((x) => x.item);
}

/**
 * 把光标处那段 `@查询词` 换成 `@名字 `。
 * ⛔ 结束位置**现算**（从 start 往后扫到空白 / 下一个 @），不吃调用方传进来的旧 caret ——
 *    面板打开期间用户可能继续打字，用旧 caret 会吃掉半句话。
 * @param text 当前整段输入
 * @param trigger `mentionTriggerOf` 的返回值（start + caret；没有 caret 的老调用按空白扫描兜底）
 * @param name 选中的人名
 * @returns { text, caret }
 */
export function applyMention(text, trigger, name) {
  const src = String(text ?? "");
  const who = String(name ?? "").trim();
  if (!who) return { text: src, caret: src.length };
  const clamp = (n) => Math.max(0, Math.min(src.length, Math.trunc(Number(n))));
  const start = clamp(trigger?.start ?? src.length);
  /* ⛔⛔ 11-07 真机：「输入框输入了很多内容，再艾特，内容直接没了」。
     旧实现从 `@` 一路吃到下一个空白 —— 中文长文本没有空格 ⇒ 整段正文被当成"查询词"吃掉，
     替换完只剩 `@名字 `。⇒ 终点改用触发时记录的 caret（用户实际打出的那几个字），
     ⛔ 没有 caret 的老调用才回退到扫描（保持既有真值表不回归）。 */
  const rawCaret = trigger?.caret;
  const hasCaret = rawCaret !== undefined && rawCaret !== null && Number.isFinite(Number(rawCaret));
  let end;
  if (hasCaret && clamp(rawCaret) >= start) {
    end = clamp(rawCaret);
  } else {
    end = start + 1;
    while (end < src.length && !/\s/.test(src[end]) && src[end] !== "@") end += 1;
  }
  /* ⛔ 只吃掉行内的空格，不动换行 —— 否则会把下一段并到这一行来 */
  const rest = src.slice(end).replace(/^[ \t]+/, "");
  const next = `${src.slice(0, start)}@${who} ${rest}`;
  return { text: next, caret: start + who.length + 2 };
}

/**
 * @ 面板的候选分类（飞书 §4 的 `single_bot` / `user_group` 本地等价物）：
 *   · 机器人：能单独派活的一个伙伴（专家 / 子智能体 / CLI）；
 *   · 专家团：`targetKind=team`，点它 = 叫整团（团内由主理人分派）；
 *   · 团成员：团里那几个人，**每一位都能单独 @**（11-07 用户令「每个成员都可以艾特」）——
 *     点它 = 直接派给这位成员，走他自己的会话，⛔ 不再退化成「叫整团让主理人转述」。
 *
 * @param group 群（只读 members）
 * @param catalog `listDispatchCatalog()` 的 targets（用来把团展开成主理人 + 成员）
 * @returns [{ key, title, items: [{ id, selectId, name, role, hint, avatar, muted, unbound }] }]
 *          ⛔ 空分类不返回（面板不画空标题）
 */
export function mentionSectionsOf(group, catalog) {
  const members = Array.isArray(group?.members) ? group.members : [];
  const cat = Array.isArray(catalog) ? catalog : [];
  const bots = [];
  const teams = [];
  const kids = [];
  const seenKids = new Set();

  for (const m of members) {
    if (!m || m.kind !== "bot") continue;
    const muted = Boolean(m.muted);
    if (m.targetKind === "team") {
      const teamId = String(m.targetKey ?? "");
      const lead = teamId ? cat.find((t) => t && t.kind === "expert" && t.teamId === teamId) ?? null : null;
      const children = teamId ? cat.filter((t) => t && t.kind === "member" && t.teamId === teamId) : [];
      teams.push({
        id: String(m.id),
        selectId: String(m.id),
        name: String(lead?.name || m.name || ""),
        role: String(lead?.profession || m.targetProfession || "专家团"),
        hint: `${m.name || "专家团"} · ${children.length} 位成员 · 点它 = 叫整团`,
        /* 头像种子用主理人（与成员栏/群头同一口径），否则会画成团队徽章 */
        avatar: lead
          ? { ...m, targetKind: "expert", targetKey: lead.key, name: lead.name }
          : m,
        muted,
        unbound: !teamId,
      });
      for (const k of children) {
        const key = String(k?.key ?? "");
        if (!key || seenKids.has(key)) continue;
        seenKids.add(key);
        /* ⛔⛔ 目录里 member 的 `key` 是 `<teamId>:<memberId>`（dispatch-core 拼的），
           ⛔ 不能当 memberId 用 —— 否则合成 id 会变成 `team:t1:t1:问需`，
           派活时下发的 targetKey 与目录 key 对不上 ⇒ 报「找不到可调度对象」，运行态从不出现
           （11-07 实测：点了发送、群里毫无反应）。裸 id 取 `memberId`，取不到才按冒号切末段。 */
        const memberKey = teamMemberIdOf(k) || key;
        kids.push({
          id: `kid:${key}`,
          /* ⛔⛔ 11-07 用户令：「团成员拆出来，每个成员都可以艾特」「现在只能艾特主代理会话」。
             以前 selectId 指向团那一行（= 叫整团 ⇒ 成员本人收不到，主理人替他说话）。
             现在指向**成员本人**：合成 id `team:<teamId>:<memberId>`，
             派活时下发 `kind:"member"` + key `<teamId>:<memberId>`（主进程调度目录里
             每位团成员都有这一条，见 dispatch-core 的 member 分支）⇒ 走成员自己的会话。 */
          selectId: teamAuthorIdOf(teamId, memberKey),
          name: String(k.name ?? key),
          role: String(k.profession || "团成员"),
          hint: `只叫${String(k.name ?? key)}本人（不经过主理人）`,
          avatar: { id: key, kind: "bot", name: String(k.name ?? key), targetKind: "member", targetKey: key },
          muted,
          unbound: false,
        });
      }
      continue;
    }
    bots.push({
      id: String(m.id),
      selectId: String(m.id),
      name: String(m.name || ""),
      role: String(m.targetProfession || "伙伴"),
      hint: muted ? "已静音" : (m.targetKind ? "" : "未绑定智能体"),
      avatar: m,
      muted,
      unbound: !m.targetKind || !m.targetKey,
    });
  }

  return [
    { key: "bot", title: "机器人", items: bots },
    { key: "team", title: "专家团", items: teams },
    { key: "kid", title: "团成员", items: kids },
  ].filter((section) => section.items.length > 0);
}

/** 面板里所有候选拍平（键盘选第一个 / 统计用）。 */
export function flattenMentionSections(sections) {
  return (Array.isArray(sections) ? sections : []).flatMap((s) => (Array.isArray(s?.items) ? s.items : []));
}
