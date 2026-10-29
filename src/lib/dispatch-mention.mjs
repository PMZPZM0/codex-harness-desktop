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
 * @returns {{ groups: Array<{kind:string,label:string,hint:string,items:any[]}>, total:number, overflow:number }}
 */
export function filterMentionTargets(targets, query) {
  const list = Array.isArray(targets) ? targets : [];
  const groups = [];
  let total = 0;
  let overflow = 0;
  for (const group of MENTION_GROUPS) {
    const hits = list
      .filter((target) => target && target.kind === group.kind)
      .map((target, index) => ({ target, rank: rankMentionTarget(target, query), index }))
      .filter((entry) => entry.rank >= 0)
      // 同分保持目录顺序（稳定），否则选区会随打字乱跳
      .sort((a, b) => a.rank - b.rank || a.index - b.index);
    const items = hits.slice(0, MENTION_PER_GROUP).map((entry) => entry.target);
    if (items.length) groups.push({ kind: group.kind, label: group.label, hint: group.hint, items });
    total += items.length;
    overflow += Math.max(0, hits.length - items.length);
  }
  return { groups, total, overflow };
}

/** 面板按 ↑↓/Enter 的线性顺序（分组顺序 → 组内顺序）。 */
export function flatMentionTargets(groups, limit = MENTION_MAX) {
  const list = Array.isArray(groups) ? groups : [];
  return list.flatMap((group) => (Array.isArray(group?.items) ? group.items : [])).slice(0, limit);
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
 * ⛔ 三条硬约束（与 dispatch.ts 的闸门/告知保持同一口径）：
 *   ① 只说"派给谁"，不说"当作已发生" —— 真派活是模型调 agent_invoke，失败原因照样会回；
 *   ② 失败**不许重试**、不许改派：原样转述原因（用户看到的才是真的）；
 *   ③ 专家团未开启是"用户没开开关"，必须如实说，不许自己脑补成已派出。
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
    "④ kind=cli（CLI 智能体）就是本机的一个命令行工具：它会用自己的会话调 shell 跑它。任务里写清「要用什么命令 / 验收标准」；"
      + "它回报「本机没装」时**原样转述并附上安装命令**，不要自己改换别的对象、也不要假装它跑过；",
    "⑤ 派活被拒或失败（权限 / 引擎 / 名字找不到 / CLI 没装）时**原样转述原因**并停止，不要换对象重试；",
    "⑥ 派活成功就正常使用产出，不用再问用户要不要派。",
    "[点名结束]",
    "",
  ].join("\n");
}
