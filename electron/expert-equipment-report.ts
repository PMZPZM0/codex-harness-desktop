import { rootContext } from "./context";

type Row = { id: string; installed: boolean; installing: boolean; installTarget: string; fallbackPrompt: string };
type ReadRows = () => Row[];
const service = "expert.runtimeInventory";
/** 开发工具域挂载时提供只读快照，卸载时取消注册。 */
export const provideRuntimeInventory = (read: ReadRows) => rootContext.provide(service, read);
/** 读取当前工具清单，未挂载时保留未知状态。 */
export const readRuntimeInventory = () => rootContext.get<ReadRows>(service)?.();

type Skill = { name: string; enabled?: boolean };
export type Inventory = { data?: { skills?: Skill[]; errors?: unknown[] }[] };
/** 区分项目技能清单的未发现、停用与读取失败。 */
export function skillReport(id: string, inventory: Inventory | null, bundled?: Row) {
  const groups = Array.isArray(inventory?.data) ? inventory.data : [];
  const matches = groups.flatMap(group => Array.isArray(group?.skills) ? group.skills.filter(skill => skill?.name === id) : []);
  if (matches.some(skill => skill.enabled !== false)) return { id, status: "已启用" };
  if (matches.length) return { id, status: "已停用", instructions: "询问是否在技能页重新启用，随后复检。" };
  if (bundled) return { id, status: bundled.installed ? "可读取随包技能" : "随包文件缺失", instructions: bundled.fallbackPrompt };
  if (!groups.length || groups.some(group => !Array.isArray(group?.skills) || group.errors?.length)) return { id, status: "未能检测", instructions: "在当前项目重新读取技能清单后再判断是否需要安装。" };
  return { id, status: "未发现", instructions: `在技能市场按 ${id} 查找匹配项，核对来源并按 skill-audit 审查。用户确认后使用市场安装，再在当前项目刷新技能清单。` };
}

/** 按安装检测结果选择处理方式，并返回开发工具页的目标位置。 */
export function toolReport(id: string, rows: Row[] | undefined) {
  if (["engine", "image-lab"].includes(id)) return { id, status: "应用内置" };
  const row = rows?.find(item => item.id === id);
  if (!row) return { id, status: rows ? "当前平台无检测项" : "未能检测" };
  const status = row.installing ? "安装中" : row.installed ? "已就绪" : "缺少";
  return { id, status, installTarget: row.installTarget, instructions: status === "缺少" ? (id === "rea" ? "请用户在开发工具页确认此专业工具的安装。" : row.fallbackPrompt) : undefined };
}
