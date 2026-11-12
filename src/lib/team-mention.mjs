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
        /* ⛔⛔ 11-08 用户令「专家团的主代理人还是显示他名字吧」：@ 面板里这一条显示
           主理人的名字（出面说话的人），不再是团名。
           ⛔ 但 selectId 仍指向**整团** ⇒ hint 必须写清「点它 = 叫整团」，别让人以为只叫了他。
           ⛔ 上一轮「正文多一个 @团名」是正文注入造成的，已彻底删除；显示名与此无关。 */
        name: String(lead?.name || m.name || ""),
        role: String(lead?.profession || m.targetProfession || "专家团"),
        hint: `${children.length} 位成员 · 点它 = 叫整团（${String(m.name || "专家团")}）`,
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
          /* ⛔⛔ 头像 seed 取**裸 memberId**（`memberKey`），⛔ 不是目录 `key`（`<teamId>:<memberId>`）：
             消息气泡按合成 id 拆出裸 memberId 选脸，两处 seed 不同 = @ 面板与群里是两张脸（11-12 实测）。 */
          avatar: { id: key, kind: "bot", name: String(k.name ?? key), targetKind: "member", targetKey: memberKey },
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

  /* ⛔ 11-08 用户（截图）：「内置的专家，都不显示出来，就显示几个以前用过的」——
     群 @ 面板原来**只列群成员**（+ 团展开），专家库里没加过群的专家一个都看不到。
     ⇒ 增补「专家库」分组：调度目录里所有**单人专家 / 其他团的主理人**，点选即加入本群再点名。
     ⛔ 已经随团进来的主理人（那个团已在群里）不重复列；已经加进群的专家也不列。 */
  const groupTeamIds = new Set(members
    .filter((m) => m && m.kind === "bot" && m.targetKind === "team")
    .map((m) => String(m.targetKey ?? ""))
    .filter(Boolean));
  const addedExpertKeys = new Set(members
    .filter((m) => m && m.kind === "bot" && m.targetKind === "expert")
    .map((m) => String(m.targetKey ?? ""))
    .filter(Boolean));
  const library = [];
  const seenLib = new Set();
  for (const t of cat) {
    if (!t || t.kind !== "expert") continue;
    const key = String(t.key ?? "");
    if (!key || seenLib.has(key)) continue;
    if (String(t.teamId ?? "") && groupTeamIds.has(String(t.teamId ?? ""))) continue;
    if (addedExpertKeys.has(key)) continue;
    seenLib.add(key);
    library.push({
      id: `lib:${key}`,
      selectId: key,
      name: String(t.name ?? ""),
      role: String(t.profession || "专家"),
      hint: "点它 = 加入本群并点名",
      avatar: { id: key, kind: "bot", name: String(t.name ?? ""), targetKind: "expert", targetKey: key },
      muted: false,
      unbound: false,
      library: true,
    });
  }

  return [
    { key: "bot", title: "机器人", items: bots },
    { key: "team", title: "专家团", items: teams },
    { key: "kid", title: "团成员", items: kids },
    { key: "library", title: "专家库", items: library },
  ].filter((section) => section.items.length > 0);
}

/** 面板里所有候选拍平（键盘选第一个 / 统计用）。 */
export function flattenMentionSections(sections) {
  return (Array.isArray(sections) ? sections : []).flatMap((s) => (Array.isArray(s?.items) ? s.items : []));
}

/**
 * 正文里真实写到的 @名字 → 目标 id（11-08 用户：「都在输入框里面」，框外不再有 chip 行）。
 * ⛔ @ 的唯一真相源 = 正文：选伙伴 / 点成员行的 @ 都只往正文里插 `@名字 `，发消息时再从这里反查。
 * ⛔ 长名优先匹配（阿团子 > 阿团），按「首次出现位置」排序（与正文顺序一致）。
 */
/**
 * 兜底：整段没有「行首 @」，但正文里**只有一个人**被 @ —— 仍然认他。
 *
 * ⛔ 为什么留这一步：点选成员会插到光标处，光标在句中时就落在行中；
 *   全按行首判会让「我 @落纸 帮我看下这句」失效（用户会以为点了没反应）。
 * ⛔ 但**只在唯一命中时**生效：任务书里 @ 了四五个人 ⇒ 不算派活，交团主理人派单。
 */
function fallbackSingleMention(body, list) {
  const found = [];
  for (const c of list) {
    if (!body.includes(`@${c.name}`)) continue;
    if (found.some((x) => x.name.endsWith(c.name))) continue;   // 长名已占，短名不重复认
    found.push(c);
    if (found.length > 1) return [];                            // 多个 ⇒ 不当派活
  }
  return found.map((c) => c.id);
}

export function mentionTargetsInText(text, candidates) {
  const body = String(text ?? "");
  const list = (Array.isArray(candidates) ? candidates : [])
    .map((c) => ({ name: String(c?.name ?? "").trim(), id: String(c?.selectId ?? "") }))
    .filter((c) => c.name && c.id)
    .sort((a, b) => b.name.length - a.name.length);
  /* ⛔⛔ 11-10 用户现场（截图「就这种垃圾？」）：把一整段任务书贴进群，正文里写着
     「@落纸 先给选题」「@砚云 写正文」这类**流程**，原来的实现扫**全文** ⇒ 5 个人同时被唤起，
     每人读完都判断"这段不是我的活"，群里只剩「我不抢，我等派单」，谁也不动。
     ⛔ 主进程派活（`parseAgentMentions`）本来就只认**行首 @**；两边口径不一致，
       等于「正文里提到谁」=「派活给谁」。
     ⇒ 只认行首（允许缩进）。行中提到的名字只是文字，不是派活目标。
     这也和群聊协议一致（提示词里要求「另起一行、行首 @名字：」）。 */
  const starts = [];
  {
    let offset = 0;
    for (const line of body.split(/\r?\n/)) {
      const indent = line.length - line.replace(/^[ \t]+/, "").length;
      if (line.slice(indent).startsWith("@")) starts.push(offset + indent);
      offset += line.length + 1;
    }
  }
  if (!starts.length) return fallbackSingleMention(body, list);
  const hits = [];
  const taken = [];
  /* ⛔ 长名先占位、短名不许在同一段里再命中：否则「@阿团子」会被「阿团」也认一次
     （两个目标都被派活）。占位后短名仍可匹配别处的独立 @阿团。 */
  for (const c of list) {
    if (hits.some((h) => h.id === c.id)) continue;
    const token = `@${c.name}`;
    for (const at of starts) {
      const end = at + token.length;
      if (body.slice(at, end) !== token) continue;
      if (taken.some((r) => at < r.end && end > r.start)) continue;
      taken.push({ start: at, end });
      hits.push({ id: c.id, at });
      break;
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.id);
}

/**
 * 从正文里摘掉指定名字的 @（面板「清空」/ 再点一次取消）。
 * ⛔ 只认完整提及（后面是空白 / 标点 / 结尾）：否则删「阿团」会把「@阿团子」劈成「子」。
 */
export function removeMentionsFromText(text, names) {
  let out = String(text ?? "");
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const list = [...new Set((Array.isArray(names) ? names : []).map((n) => String(n ?? "").trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  for (const name of list) {
    const re = new RegExp(`@${escapeRe(name)}(?=\\s|$|[，。！？、,.!?；;：:])`, "g");
    out = out.replace(re, "");
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 正文切成「普通文本 / 提及」段（输入框行内 chip 用；11-08 用户：「输入框里面没有自动变成图二这种」）。
 * ⛔ 与 `mentionTargetsInText` 同一套匹配规则（长名优先、不重叠）——只多回位置，别再写第二套正则。
 */
export function mentionSegments(text, names) {
  const body = String(text ?? "");
  const list = [...new Set((Array.isArray(names) ? names : []).map((n) => String(n ?? "").trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  const hits = [];
  const taken = [];
  for (const name of list) {
    const token = `@${name}`;
    let from = 0;
    while (from <= body.length) {
      const at = body.indexOf(token, from);
      if (at < 0) break;
      const end = at + token.length;
      const overlap = taken.some((r) => at < r.end && end > r.start);
      if (!overlap) { taken.push({ start: at, end, name }); break; }
      from = at + 1;
    }
  }
  taken.sort((a, b) => a.start - b.start);
  const out = [];
  let cursor = 0;
  for (const hit of taken) {
    if (hit.start > cursor) out.push({ text: body.slice(cursor, hit.start) });
    out.push({ text: body.slice(hit.start, hit.end), mention: true });
    cursor = hit.end;
  }
  if (cursor < body.length) out.push({ text: body.slice(cursor) });
  return out;
}
