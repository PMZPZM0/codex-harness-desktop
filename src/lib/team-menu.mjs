/**
 * 团队模式 · 群菜单（纯函数，11-06）
 *
 * 飞书逆向 §3：机器人在群里可以挂**菜单树**（`menuItems[].childNodes`），
 * 输入框旁是否出现菜单按钮由 `needShowMenuButton = menuItems.length > 0` 决定；
 * 点一项 = 发 `TriggerMenuEvent { cliId, menuId, eventKey }`，响应可带 `showMsg` 直接当消息显示。
 *
 * 我们这版把「点击」落成本地动作：**把该菜单项的指令模板填进输入框、并选中它建议的伙伴**
 * （`showMsg` 的等价物 = 输入框上方一句回显）。⛔ 不自动发送 —— 派活是对模型的调用，
 * 用户按下发送才算数（报告里 TriggerMenuEvent 是"人点了才触发"，不是无人值守）。
 */

/** 菜单树最大深度（飞书是任意深度，但二级就够用；⛔ 深了没人点）。 */
export const MENU_MAX_DEPTH = 2;

/** 每层最多几项（与群聊输入区的可用空间匹配）。 */
export const MENU_MAX_ITEMS = 12;

/** 指令模板长度上限。 */
export const MENU_MAX_PROMPT_CHARS = 800;

/**
 * 菜单的两种展示形态（飞书 `ChatBotMenu` 的 `INPUT_FIRST` / `FLOAT`）：
 *   · `input` = 贴输入框（默认）：按钮在 `@` 行，面板向上弹；
 *   · `float` = 悬浮形态：按钮浮在群视图右下，面板是**可滚动浮层**、二级分组横向展开。
 *       —— 菜单条目多（十几个）时用它：贴输入框的形态会把输入区顶掉一半。
 */
export const MENU_PLACEMENTS = Object.freeze(["input", "float"]);

export const MENU_PLACEMENT_LABELS = Object.freeze({
  input: "贴输入框",
  float: "悬浮面板",
});

/** 归一化展示形态：非法/缺省一律 `input`（⛔ 别让坏数据把按钮画到看不见的地方）。 */
export function normalizeMenuPlacement(value) {
  const v = String(value ?? "").trim();
  return MENU_PLACEMENTS.includes(v) ? v : "input";
}

/**
 * 默认菜单：贴「工作伙伴」场景，不是泛泛的"帮助/关于"。
 * ⛔ 每条 prompt 都写成**可直接派活的完整指令**（含口径要求），
 *    否则点完用户还得自己想怎么说 —— 那就等于没做菜单。
 */
export const DEFAULT_GROUP_MENU = Object.freeze([
  {
    key: "report",
    label: "汇报",
    children: [
      { key: "report-daily", label: "今日进展", prompt: "用三点说清今天做到哪了：已完成、进行中、卡住的。不要铺垫，不要复述我的问题。" },
      { key: "report-weekly", label: "本周汇总", prompt: "汇总本周产出：关键结论、数据变化、下周建议。控制在 200 字内，能用表格就用表格。" },
    ],
  },
  {
    key: "analyze",
    label: "分析",
    children: [
      { key: "analyze-check", label: "数据核对", prompt: "核对我给的数据与群参考文件是否一致：列出不一致的项、差异幅度、最可能的原因。不要猜数，缺就说缺。" },
      { key: "analyze-risk", label: "风险清单", prompt: "列出这件事最可能出问题的三个点，每个给一个可执行的应对动作。按影响从大到小排。" },
    ],
  },
  {
    key: "deliver",
    label: "交付",
    children: [
      { key: "deliver-plan", label: "出方案", prompt: "给一个可直接执行的方案：目标、步骤、每步的验收标准。不要展开背景，我看过。" },
      { key: "deliver-doc", label: "写文档", prompt: "按 Markdown 写一份可直接用的文档：标题、要点列表、必要时用表格。不要写「总之」「综上」这类废话。" },
    ],
  },
]);

/**
 * 一条菜单项归一化。
 * ⛔ 有 children ⇒ 是分组（本身不可点，prompt 忽略）；没有 children ⇒ 是叶子（必须有 prompt）。
 * ⛔ key 必须唯一且稳定（它是 `eventKey`，改了等于换了一项）。
 */
export function normalizeMenuItem(entry, depth = 1) {
  const key = String(entry?.key ?? "").trim();
  const label = String(entry?.label ?? "").trim();
  if (!key || !label) return null;
  const rawChildren = Array.isArray(entry?.children) ? entry.children : [];
  const children = depth < MENU_MAX_DEPTH
    ? rawChildren.map((c) => normalizeMenuItem(c, depth + 1)).filter(Boolean).slice(0, MENU_MAX_ITEMS)
    : [];
  /* ⛔ 清掉开发标记：`⛔` 是代码里的"不许这样做"记号，落到用户输入框里就是乱入的红圈。
     旧数据（存过的默认菜单）也走这条 ⇒ 一处口径把历史数据一起洗干净。 */
  const prompt = String(entry?.prompt ?? "").replace(/⛔\s*/g, "").trim().slice(0, MENU_MAX_PROMPT_CHARS);
  if (!children.length && !prompt) return null;
  return {
    key,
    label: label.slice(0, 24),
    prompt: children.length ? "" : prompt,
    disabled: Boolean(entry?.disabled),
    /* 飞书 menuItems 的 tag：显示在项后面的小字（这里用作"说明"） */
    tag: String(entry?.tag ?? "").trim().slice(0, 20),
    children,
  };
}

/**
 * 整棵树归一化 + key 去重（重复 key 直接丢后者，⛔ 不静默改 key）。
 * ⛔⛔ 去重必须是**全局**的：key 是 `eventKey`，父子同名时 `findMenuLeaf` 只会命中一个，
 *   点另一个等于点了同一个 —— 所以这里连子项一起查重（⛔ 不能只查顶层）。
 * ⛔ 分组里的子项被去重光了 ⇒ 这分组也丢掉（⛔ 不留一个点开是空的分组）。
 */
export function normalizeMenu(items) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const item = normalizeMenuItem(raw, 1);
    if (!item || seen.has(item.key)) continue;
    seen.add(item.key);
    if (item.children.length) {
      const kids = [];
      for (const child of item.children) {
        if (seen.has(child.key)) continue;
        seen.add(child.key);
        kids.push(child);
      }
      if (!kids.length) continue;
      item.children = kids;
    }
    out.push(item);
    if (out.length >= MENU_MAX_ITEMS) break;
  }
  return out;
}

/**
 * 菜单按钮是否该出现（飞书 `needShowMenuButton = menuItems.length > 0` 的同一条判据）。
 * ⛔ 空菜单不画一个点开是空的按钮。
 */
export function shouldShowMenuButton(group) {
  const items = Array.isArray(group?.menu) ? group.menu : [];
  return items.length > 0;
}

/**
 * 摊平成"可点的叶子"（渲染只画两层，所以要带分组名做前缀）。
 * @returns [{ key, label, fullLabel, prompt, tag, disabled, parentLabel }]
 */
export function flattenMenu(items) {
  const out = [];
  for (const item of normalizeMenu(items)) {
    if (item.children.length) {
      for (const child of item.children) {
        out.push({
          key: child.key,
          label: child.label,
          fullLabel: `${item.label} / ${child.label}`,
          prompt: child.prompt,
          tag: child.tag,
          disabled: child.disabled,
          parentLabel: item.label,
        });
      }
    } else {
      out.push({
        key: item.key,
        label: item.label,
        fullLabel: item.label,
        prompt: item.prompt,
        tag: item.tag,
        disabled: item.disabled,
        parentLabel: "",
      });
    }
  }
  return out;
}

/** 按 key 找叶子（TriggerMenuEvent 的 eventKey 解析）。找不到返回 null。 */
export function findMenuLeaf(items, key) {
  const k = String(key ?? "");
  return flattenMenu(items).find((x) => x.key === k) ?? null;
}

/**
 * 加一条**自定义指令**（归到「自定义」分组下；没有就建一个）。
 * ⛔ 生成的 key 带序号不重复（key 是 `eventKey`，重复 ⇒ 点谁都触发同一个）。
 */
export function addMenuLeaf(items, leaf) {
  const label = String(leaf?.label ?? "").trim().slice(0, 24);
  const prompt = String(leaf?.prompt ?? "").trim().slice(0, MENU_MAX_PROMPT_CHARS);
  if (!label || !prompt) return normalizeMenu(items);
  const base = normalizeMenu(items);
  const customKey = "custom";
  const custom = base.find((x) => x.key === customKey) ?? { key: customKey, label: "自定义", prompt: "", disabled: false, tag: "", children: [] };
  const used = new Set(flattenMenu(base).map((x) => x.key));
  let n = 1;
  while (used.has(`custom-${n}`)) n += 1;
  const next = {
    ...custom,
    children: [...custom.children, { key: `custom-${n}`, label, prompt, disabled: false, tag: "", children: [] }].slice(0, MENU_MAX_ITEMS),
  };
  const rest = base.filter((x) => x.key !== customKey);
  return normalizeMenu([...rest, next]);
}

/** 删一个叶子（分组删空 ⇒ 分组一起消失，⛔ 不留一个点开是空的分组）。 */
export function removeMenuLeaf(items, key) {
  const k = String(key ?? "");
  const out = [];
  for (const item of normalizeMenu(items)) {
    if (item.key === k) continue; // 顶层叶子
    if (!item.children.length) { out.push(item); continue; }
    const kids = item.children.filter((c) => c.key !== k);
    if (kids.length) out.push({ ...item, children: kids });
  }
  return out;
}

/**
 * 点了一个菜单项之后，输入框里应该变成什么。
 * ⛔ 纯函数：界面拿到结果自己 setState，⛔ 不在这里发请求。
 * @returns { ok, prompt, message }
 */
export function menuPickResult(items, key) {
  const leaf = findMenuLeaf(items, key);
  if (!leaf) return { ok: false, prompt: "", message: "这个菜单项已经不在了（可能被改过）" };
  if (leaf.disabled) return { ok: false, prompt: "", message: `「${leaf.fullLabel}」当前不可用` };
  return {
    ok: true,
    prompt: leaf.prompt,
    /* `showMsg` 的等价物：明确告诉用户"我往输入框里放了什么，还没发" */
    message: `已把「${leaf.fullLabel}」填进输入框，确认后按发送`,
  };
}
