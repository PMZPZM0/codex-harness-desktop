/**
 * 工作伙伴群「模板」（2026-11-14 Phase 3，抄 Pachat 的「公开群可复用」本地版）。
 *
 * 用途：把某个群的**可复用配置**（成员 / 群简介 / 群规矩 / 项目地址）存成模板，
 *       新建群时一键套用 —— 本地应用没有云端群注册表，「公开群」落到本地就是「群模板」。
 * ⛔ 只存**渲染层 localStorage**（团队群本身在主进程，但模板只是用户便利，不需要 IPC/落主进程）：
 *   这样不必新增 IPC 通道与重生成 preload/vite-env（上一轮已吃过并发覆盖生成物的亏）。
 * ⛔ localStorage 访问全部 try/兜底；纯变换函数（templateFromGroup / templateToCreateInput）
 *   不碰浏览器 API ⇒ 守卫可直接 import 跑真值表。
 */

export const TEMPLATES_KEY = "team-group-templates-v1";
export const MAX_TEMPLATES = 30;
const MAX_TEMPLATE_NAME = 40;

/** 从群对象抽可复用配置。纯函数（只读入参，不碰存储）。 */
export function templateFromGroup(group) {
  const g = group && typeof group === "object" ? group : {};
  const members = (Array.isArray(g.members) ? g.members : [])
    .map((m) => ({
      id: String(m?.id ?? ""),
      kind: String(m?.kind ?? "bot"),
      name: String(m?.name ?? ""),
      targetKind: String(m?.targetKind ?? ""),
      targetKey: String(m?.targetKey ?? ""),
      targetProfession: String(m?.targetProfession ?? ""),
    }))
    .filter((m) => m.id && m.name);
  return {
    id: String(g.id ?? "") || `tpl_${Date.now().toString(36)}`,
    name: (String(g.name ?? "").trim() || "未命名群").slice(0, MAX_TEMPLATE_NAME),
    members,
    memory: String(g.memory ?? ""),
    rules: String(g.rules ?? ""),
    workspace: String(g.workspace ?? ""),
    savedAt: Date.now(),
  };
}

/** 模板 → 建群入参（与 TeamCreateInput / 主进程 createGroup 同字段）。纯函数。 */
export function templateToCreateInput(t) {
  const x = t && typeof t === "object" ? t : {};
  return {
    name: String(x.name ?? "").trim() || "新建群",
    memory: String(x.memory ?? ""),
    rules: String(x.rules ?? ""),
    workspace: String(x.workspace ?? ""),
    members: (Array.isArray(x.members) ? x.members : []).map((m) => ({ ...m })),
  };
}

function readRaw() {
  try {
    if (typeof localStorage === "undefined") return [];
    const arr = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "[]");
    return Array.isArray(arr) ? arr.filter((t) => t && typeof t === "object" && t.name) : [];
  } catch {
    return [];
  }
}

/** 列出已存模板（新的在前）。 */
export function listTemplates() {
  return readRaw();
}

/** 存模板：按**模板名 upsert**（同名覆盖，新的在前），最多 MAX_TEMPLATES 个。返回最新列表。 */
export function saveTemplate(tpl) {
  if (typeof localStorage === "undefined") return [];
  const t = tpl && typeof tpl === "object" ? tpl : null;
  if (!t || !t.name) return readRaw();
  const rest = readRaw().filter((x) => x.name !== t.name);
  const next = [{ ...t, savedAt: Date.now() }, ...rest].slice(0, MAX_TEMPLATES);
  try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next)); } catch { /* 隐私模式/配额：忽略 */ }
  return next;
}

/** 删模板（按模板名）。返回最新列表。 */
export function removeTemplate(name) {
  if (typeof localStorage === "undefined") return [];
  const key = String(name ?? "");
  const next = readRaw().filter((x) => x.name !== key);
  try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next)); } catch { /* 忽略 */ }
  return next;
}
