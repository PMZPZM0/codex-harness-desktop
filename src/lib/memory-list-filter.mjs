/**
 * 四个记忆板块共用的列表逻辑（11-11 用户令「其他也都是一样的，都加上四个记忆板块」）。
 *
 * ⛔ 纯函数：守卫 12bl 直接 import 在 Node 里真跑，不靠人眼看界面。
 * ⛔ 各板块数据结构不同 ⇒ 这里只提供「搜索 + 谓词组合 + 勾选」三件原语，
 *    具体筛选项（会话状态 / 条目类型 / 作用域 / 归属群）由调用方传 predicates。
 * ⛔ 不用 disabled 表达归属，也不在这里写任何 IPC。
 */

/** 中文名字按子串匹配（⛔ 别塞 bigram：短名「甘泉」会被切碎导致零召回）。 */
export function matchesQuery(text, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return true;
  return String(text ?? "").toLowerCase().includes(q);
}

/**
 * @param rows 任意行数组
 * @param opts { query?, textOf?: (row)=>string, predicates?: Array<(row)=>boolean> }
 */
export function filterRows(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const textOf = typeof opts?.textOf === "function" ? opts.textOf : (r) => `${String(r?.id ?? "")} ${String(r?.name ?? "")}`;
  const predicates = Array.isArray(opts?.predicates) ? opts.predicates.filter((p) => typeof p === "function") : [];
  return list.filter((r) => matchesQuery(textOf(r), opts?.query) && predicates.every((p) => p(r)));
}

/** 全选 / 取消：只作用于当前筛选后可见的 ids（⛔ 不许把看不见的行一起选中）。 */
export function toggleSelection(selected, visibleIds, checked) {
  const next = new Set(Array.isArray(selected) ? selected.map(String) : []);
  for (const id of (Array.isArray(visibleIds) ? visibleIds : [])) {
    if (checked) next.add(String(id));
    else next.delete(String(id));
  }
  return [...next];
}

/* ── 筛选项常量（四个板块共用一份，⛔ 不各写一份文案） ─────────────────── */
export const MEMORY_STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "alive", label: "会话还在" },
  { value: "gone", label: "会话已删" },
];
export const MEMORY_CONTENT_OPTIONS = [
  { value: "all", label: "不限内容" },
  { value: "has", label: "有记忆内容" },
  { value: "empty", label: "还没有记忆" },
];
export const ATOM_TYPE_OPTIONS = [
  { value: "all", label: "全部类型" },
  { value: "rule", label: "规则" },
  { value: "decision", label: "决定" },
  { value: "fact", label: "事实" },
  { value: "runbook", label: "流程" },
  { value: "preference", label: "偏好" },
];
export const ATOM_SCOPE_OPTIONS = [
  { value: "all", label: "全部作用域" },
  { value: "project", label: "项目级" },
  { value: "rule", label: "纪律" },
  { value: "session", label: "会话级" },
];
export const ATOM_STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "active", label: "生效中" },
  { value: "retired", label: "已作废" },
];
