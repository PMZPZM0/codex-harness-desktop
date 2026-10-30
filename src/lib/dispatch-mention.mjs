/**
 * @ 提及（点名调度对象）的**纯函数层**：候选筛选 / 排序 / 分组，以及发送时注入的指令块。
 *
 * 为什么放基座层：渲染层要按 query 实时筛（每键一次）、守卫要能离线真跑，
 * 都不该依赖 React 或 Electron。⛔ 不读盘、不查目录 —— 目录由调用方传进来
 * （`bag.dispatchInfo.targets`，真相源在主进程 `agents:catalog`）。
 *
 * 语义边界（10-29 定）：
 *   · `@` = 点名**调度对象**（专家 / 子智能体 / 专家团）；
 *   · `*` = 引用**历史消息上下文**（同一天用户令：「把 @ 引用上下文改成 * 引用上下文」）；
 *   · `#` = 引用技能。
 *   ⛔ 三者候选面板共用同一个弹层，但候选来源互不混（见 03-composer 的 `.context-picker`）。
 */

/** 分组顺序即面板展示顺序（专家的使用频率最高；专家团最重，放最后）。 */
export const MENTION_GROUPS = [
  { kind: "expert", label: "专家", hint: "单个专家 · 开独立会话产出" },
  { kind: "subagent", label: "子智能体", hint: "你配置的自定义角色 · 没有可一键新建" },
  { kind: "cli", label: "CLI 智能体", hint: "本机命令行工具（Claude Code / OpenClaw 等）· 在开发工具里接入" },
  { kind: "team", label: "专家团", hint: "主理人按 SOP 拉成员 · 需开启专家团" },
];

/** 组的 kind → 芯片/列表上的类名标签。
 *  ⛔ 10-29 晚补 cli：芯片原来写的是三元（expert ? 专家 : team ? 专家团 : 子智能体），
 *    CLI 没分支 ⇒ 落到最后的 else，被显示成「子智能体」—— 用户会以为自己点的是别的对象。
 *    单一真相源收在这里，面板与芯片都读它。 */
export const MENTION_KIND_LABEL = { expert: "专家", subagent: "子智能体", cli: "CLI", team: "专家团", member: "团成员" };

export function mentionKindLabel(kind) {
  return MENTION_KIND_LABEL[String(kind ?? "")] ?? String(kind ?? "");
}

/**
 * 这一类在本会话能不能派（10-30 用户令：候选列表要**按调度开通状态联动**）。
 *
 * ⛔ 与 `electron/dispatch.ts` 的 `dispatchAllowOf` **同口径**：专家 / 子智能体 / CLI 恒可用，
 *    专家团跟随用户开关（缺键按关处理 —— `dispatchAllowOf` 也是 `team === true`）。
 * ⛔ 这里只回答"能不能选"，**不负责隐藏**：未开通的类别仍要出现在列表里（置灰不可选），
 *    否则用户会以为"团队丢了"，而真因是没开开关（10-30 用户原话：置灰不可选，开通后恢复）。
 * @param {{ team?: boolean } | null | undefined} allow 会话调度许可（`bag.activeDispatch`）
 * @param {string} kind
 * @returns {boolean}
 */
export function mentionKindAllowed(allow, kind) {
  if (!allow || typeof allow !== "object") return true;
  if (kind === "team" || kind === "member") return allow.team === true;
  return true;
}

/** 每组最多显示几条（面板高度有限；超出用「还有 N 个，继续输入筛选」提示）。 */
export const MENTION_PER_GROUP = 6;
/** 一次消息最多点名几个对象（≥ 这个数就是"群发"，通常说明用户在乱试）。 */
export const MENTION_MAX = 8;

const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLowerCase();

/** query 归一化：小写 + 折叠空白（CJK 直接子串匹配，不做分词 —— 名字通常很短）。 */
export function normalizeMentionQuery(raw) {
  return lower(raw).replace(/\s+/g, " ");
}

/**
 * 单条候选的相关度：0 完全相等 / 1 前缀 / 2 名称或简介包含 / -1 不匹配。
 * ⛔ -1 必须由调用方丢弃 —— 面板里出现"完全不相关"的行，用户会以为筛选坏了。
 */
export function rankMentionTarget(target, query) {
  const q = normalizeMentionQuery(query);
  if (!q) return 0;
  const name = lower(target?.name);
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  const hay = [target?.name, target?.profession, target?.description].map(lower).join(" ");
  return hay.includes(q) ? 2 : -1;
}

/**
 * 按类型分组筛选候选。
 * @param {Array<{kind:string,name:string,key:string,profession?:string,description?:string}>} targets
 * @param {string} query `@` 后面那段（不含 `@`）
 * @param {{ team?: boolean } | null} [allow] 会话调度许可：未开通的类别**照样列出**，但每行标 `disabled`
 * @returns {{ groups: Array<{kind:string,label:string,hint:string,items:any[],off:boolean}>, total:number, overflow:number }}
 */
export function filterMentionTargets(targets, query, allow = null) {
  const list = Array.isArray(targets) ? targets : [];
  const groups = [];
  let total = 0;
  let overflow = 0;
  for (const group of MENTION_GROUPS) {
    /* ★ 10-30 用户令：「未开通专家团调度时列表中的『专家团』项置灰不可选，开通后自动恢复为可选中高亮」——
       所以这里**不筛掉**未开通的类别，只给每行打 `disabled` 标记（面板负责置灰 + 拒绝选中）。
       ⛔ 若改成"筛掉"，用户看到的是"团队不见了"，无法得知是开关没开（这是上一版的真问题）。 */
    const off = !mentionKindAllowed(allow, group.kind);
    const hits = list
      .filter((target) => target && target.kind === group.kind)
      .map((target, index) => ({ target, rank: rankMentionTarget(target, query), index }))
      .filter((entry) => entry.rank >= 0)
      // 同分保持目录顺序（稳定），否则选区会随打字乱跳
      .sort((a, b) => a.rank - b.rank || a.index - b.index);
    /* ⛔ 标记成新对象（不原地改目录条目）：`dispatchInfo.targets` 是共享引用，
       改它会污染其他消费方（调度面板的计数、工具描述展示）。 */
    const items = hits.slice(0, MENTION_PER_GROUP).map((entry) => (off ? { ...entry.target, disabled: true } : entry.target));
    if (items.length) groups.push({ kind: group.kind, label: group.label, hint: group.hint, items, off });
    total += items.length;
    overflow += Math.max(0, hits.length - items.length);
  }
  return { groups, total, overflow };
}

/** 面板按 ↑↓/Enter 的线性顺序（分组顺序 → 组内顺序）。
 *  ⛔ 置灰行**不参与**键盘顺序：↑↓ 停在灰行上、Enter 把灰行加进点名，都是"看得见却选不了"的反面教材。 */
export function flatMentionTargets(groups, limit = MENTION_MAX) {
  const list = Array.isArray(groups) ? groups : [];
  return list
    .flatMap((group) => (Array.isArray(group?.items) ? group.items : []))
    .filter((target) => !target?.disabled)
    .slice(0, limit);
}

/** Enter 直接采纳"第一条可选候选"（居中编辑器与输入框两处共用，⛔ 别各写一份跳过逻辑）。 */
export function firstMentionTarget(targets, query, allow = null) {
  return flatMentionTargets(filterMentionTargets(targets, query, allow).groups, 1)[0] ?? null;
}

/**
 * Enter 的**决策**（比 firstMentionTarget 多一件事：区分"没有候选"与"候选全被置灰"）。
 *
 * ⛔⛔ 为什么要区分：输入框里有两条 Enter 分支 —— 先采纳 @ 候选，再采纳入历史消息。
 *   用户 `@软件开发专家团` + Enter 时，专家团若未开通 ⇒ 候选全被置灰 ⇒ 若只判断"没有可选候选"，
 *   就会继续落到第二条分支，**把一条历史消息悄悄塞进输入框**（10-30 自查时发现的退化）。
 *   置灰是"看见了但不能选"，正确反应是**什么都不做**（开关提示已经在列表里），不是替你选别的。
 * @returns {{ target: any | null, disabledOnly: boolean }}
 */
export function mentionEnterPlan(targets, query, allow = null) {
  const result = filterMentionTargets(targets, query, allow);
  const target = flatMentionTargets(result.groups, 1)[0] ?? null;
  return { target, disabledOnly: !target && result.total > 0 };
}

/** 已点名对象的去重键（key 优先，回落 kind+name）。 */
export function mentionKeyOf(target) {
  const key = text(target?.key);
  return key ? `${text(target?.kind)}|${key}` : `${text(target?.kind)}|${lower(target?.name)}`;
}

/** 加一个点名对象（去重、超上限丢弃）；返回新数组，便于 setState 直接吃。 */
export function addMention(list, target) {
  const current = Array.isArray(list) ? list : [];
  if (!target || !target.kind || !text(target.name)) return current;
  if (current.length >= MENTION_MAX) return current;
  const key = mentionKeyOf(target);
  return current.some((entry) => mentionKeyOf(entry) === key) ? current : [...current, target];
}

/**
 * 发送时注入正文的指令块（模型侧唯一的"用户点名了谁"通道）。
 *
 * ⛔ 四条硬约束（与 dispatch.ts 的闸门/告知保持同一口径）：
 *   ① 只说"派给谁"，不说"当作已发生" —— 真派活是模型调 agent_invoke，失败原因照样会回；
 *   ② 失败**不许重试**、不许改派：原样转述原因（用户看到的才是真的）；
 *   ③ 专家团未开启是"用户没开开关"，必须如实说，不许自己脑补成已派出；
 *   ④ **输入框里的可选择范围 = 本段的描述**：@ 列表按调度开关实时联动，未开通的类别
 *      在列表里**置灰不可选**（不是消失），打开开关后立刻恢复可选 —— 用户说「@ 里没有
 *      专家团 / 专家团是灰的」时，答案永远是"去顶栏「调度」打开"，不是"没有这个团队"。
 * @param {Array<{kind:string,name:string}>} mentions
 * @returns {string} 空数组返回空串（调用方据此不加段，正文一字不多）
 */
export function mentionBlockOf(mentions) {
  const list = (Array.isArray(mentions) ? mentions : []).filter((entry) => entry && entry.kind && text(entry.name));
  if (!list.length) return "";
  const rows = list.map((entry) => `- kind=${text(entry.kind)} name=${text(entry.name)}`).join("\n");
  return [
    "",
    "",
    "[本轮点名对象]",
    "用户在本条消息里用 @ 点名了下面这些对象。**必须**用 agent_invoke 把它们派出去，再用它们的产出回答：",
    rows,
    "规则：",
    "① 把本条消息的正文（不含本段）当作交给它的 query，写自包含（它看不到本会话上下文）；",
    "② 点名多个时按上面顺序**逐个**派活，不要合并成一次调用；",
    "③ kind=team（专家团）未开启时不要硬派，直接在回复里说明「专家团未开启，需要你在顶栏调度面板打开」，并给出替代方案；",
    "④ 输入框（@ 唤出的选择列表）与本段的许可范围**始终一致**：未开通的类别仍在列表里但**置灰不可选**，"
      + "用户打开顶栏「调度」里的对应开关后会**实时**恢复为可选中。所以用户问「为什么 @ 里专家团是灰的 / 没有团队」时，"
      + "回答「该类别未开通，去顶栏「调度」打开即可」，**不要说这个团队不存在、也不要建议重建**；",
    "⑤ kind=cli（CLI 智能体）就是本机的一个命令行工具：它会用自己的会话调 shell 跑它。任务里写清「要用什么命令 / 验收标准」；"
      + "它回报「本机没装」时**原样转述并附上安装命令**，不要自己改换别的对象、也不要假装它跑过；",
    "⑥ 派活被拒或失败（权限 / 引擎 / 名字找不到 / CLI 没装）时**原样转述原因**并停止，不要换对象重试；",
    "⑦ 派活成功就正常使用产出，不用再问用户要不要派。",
    "[点名结束]",
    "",
  ].join("\n");
}
