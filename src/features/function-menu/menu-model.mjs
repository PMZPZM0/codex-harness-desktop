/**
 * 功能入口菜单的纯数据模型（10-22 用户：入口支持多种展示方式、拖动排序、收进「更多」）。
 *
 * ⛔ 纯函数、零依赖：渲染层与守卫共用同一套归一化/移动规则，绝不能各写一份。
 * ⛔ 入口 id 是**跨文件契约**：侧栏、对话框上方、控制台编辑器和守卫都按这组 id 对；
 *    新增入口时只改这里 + 渲染层的图标表，旧配置会自动追加到末尾（不会丢）。
 */

/* 10-25：extensions（拓展）拉出为快捷区常驻入口（新会话/中枢下面的第三行）⇒ 不再参与折叠组排序。
       旧配置里的 extensions 会被归一化丢弃（is id 校验），不会报错。 */
export const FUNCTION_MENU_IDS = ["schedule", "frontend", "team", "devtools", "favorites", "identity", "login", "newbie"];

/** 默认顺序 = 10-21 用户定下、10-25 起拓展拉出后的顺序（自动化 → 前端开发 → 团队 → 个性化&记忆 → 登录管理 → 新手教程）。 */
export const FUNCTION_MENU_DEFAULT_ORDER = [...FUNCTION_MENU_IDS];

export const FUNCTION_MENU_DEFAULT = Object.freeze({
  location: "bottom",
  order: FUNCTION_MENU_DEFAULT_ORDER,
  overflow: [],
});

/** 扩展项 id 形如 `ext_set_models`（来自 extensions:catalog）：与内置项**同权**参与排序/更多分组。
 *  ⛔ 10-30 用户：「新增的支持删和排序，为啥要在下面加」——别再把自定义项塞独立区块。 */
export const FUNCTION_MENU_EXT_ID_RE = /^ext_[a-zA-Z0-9_-]{1,80}$/;

export function isFunctionMenuId(id) {
  const value = String(id ?? "");
  return FUNCTION_MENU_IDS.includes(value) || FUNCTION_MENU_EXT_ID_RE.test(value);
}

/**
 * 归一化任意落盘值：
 *  - 未知 id 丢掉；重复 id 去重；
 *  - 旧配置里没有的新入口自动追加（升级不丢新功能）；
 *  - overflow 只能是 order 的子集；
 *  - location 认 top（新建/搜索下面）/ bottom（侧栏底部）；旧值 sidebar→bottom、composer→top；
 *    缺省 = 侧栏底部（10-24 用户确认：安装后的默认布局是底部折叠）。
 */
export function normalizeFunctionMenu(input) {
  const source = input && typeof input === "object" ? input : {};
  const order = [];
  for (const raw of Array.isArray(source.order) ? source.order : []) {
    const id = String(raw ?? "");
    if (isFunctionMenuId(id) && !order.includes(id)) order.push(id);
  }
  for (const id of FUNCTION_MENU_DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
  const overflow = [];
  for (const raw of Array.isArray(source.overflow) ? source.overflow : []) {
    const id = String(raw ?? "");
    if (order.includes(id) && !overflow.includes(id)) overflow.push(id);
  }
  return {
    location: source.location === "top" || source.location === "composer" ? "top" : "bottom",
    order,
    overflow,
  };
}

/** 可见项（不在「更多」里），保持顺序。 */
export function visibleFunctionMenuItems(config) {
  const c = normalizeFunctionMenu(config);
  return c.order.filter((id) => !c.overflow.includes(id));
}

/** 「更多」里的项，保持顺序。 */
export function overflowFunctionMenuItems(config) {
  const c = normalizeFunctionMenu(config);
  return c.order.filter((id) => c.overflow.includes(id));
}

/**
 * 拖动落点：把 id 移到 targetList（visible / overflow），插到 beforeId 之前（无 beforeId 则末尾）。
 * ⛔ 顺序与「是否在更多里」是**两个维度**：跨组拖动只改 overflow 标记，不丢原顺序。
 */
export function moveFunctionMenuItem(config, id, targetList, beforeId = null) {
  const c = normalizeFunctionMenu(config);
  const item = String(id ?? "");
  if (!isFunctionMenuId(item)) return c;
  const before = beforeId == null ? "" : String(beforeId);
  const overflow = new Set(c.overflow);
  if (targetList === "overflow") overflow.add(item);
  else overflow.delete(item);
  const order = c.order.filter((entry) => entry !== item);
  const at = before && before !== item ? order.indexOf(before) : -1;
  if (at >= 0) order.splice(at, 0, item);
  else order.push(item);
  return normalizeFunctionMenu({ ...c, order, overflow: [...overflow] });
}

/** 键盘/按钮的“移入更多 / 移回菜单”入口（与拖动落点同源）。 */
export function setFunctionMenuItemOverflow(config, id, inOverflow) {
  return moveFunctionMenuItem(config, id, inOverflow ? "overflow" : "visible");
}

/** 在可见组内上移/下移一名（供编辑器按钮使用；拖动是自由落点）。 */
export function nudgeFunctionMenuItem(config, id, delta) {
  const c = normalizeFunctionMenu(config);
  const list = c.overflow.includes(id) ? c.order.filter((entry) => c.overflow.includes(entry)) : c.order.filter((entry) => !c.overflow.includes(entry));
  const from = list.indexOf(id);
  if (from < 0) return c;
  const to = Math.max(0, Math.min(list.length - 1, from + delta));
  if (to === from) return c;
  const next = [...list];
  next.splice(from, 1);
  next.splice(to, 0, id);
  // 只重排同组在总顺序里的位置：把该组的槽位替换成新顺序，另一组相对位置不动。
  const slots = c.order.map((entry, index) => ({ entry, index })).filter(({ entry }) => (c.overflow.includes(entry) ? c.overflow.includes(id) : !c.overflow.includes(entry)));
  const order = [...c.order];
  slots.forEach((slot, index) => { order[slot.index] = next[index]; });
  return normalizeFunctionMenu({ ...c, order });
}

export function setFunctionMenuLocation(config, location) {
  const c = normalizeFunctionMenu(config);
  return { ...c, location: location === "top" ? "top" : "bottom" };
}

/** 恢复默认只恢复排序与分组，**保留用户选的位置**（在对话框上方编辑时不该被弹回侧栏）。 */
export function resetFunctionMenuLayout(config) {
  const c = normalizeFunctionMenu(config);
  return normalizeFunctionMenu({ ...FUNCTION_MENU_DEFAULT, location: c.location });
}
