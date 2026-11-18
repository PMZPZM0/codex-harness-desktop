type Declaration = { tools?: string[]; skills?: string[] };
const builtins = new Map([["engine", "对话引擎"], ["image-lab", "图像工作台"]]);
/** 合并团队与成员声明，展开成开发工具页的安装项。 */
export function expertEquipment(team: Declaration, member: Declaration) {
  const declared = [...(team.tools ?? []), ...(member.tools ?? [])];
  const tools = [...new Set(declared.flatMap(id => id === "bundled-tool" ? ["python", "node", "git"] : [id === "lark-cli" ? "feishu-cli" : id]))];
  return { tools, skills: [...new Set([...(team.skills ?? []), ...(member.skills ?? [])])] };
}
/** 用本机运行时清单判断每项工具的可用性。 */
export function equipmentState(id: string, rows: DevRuntimeEntry[] | null) {
  const row = rows?.find(r => r.id === id);
  const builtin = builtins.get(id);
  const state = builtin || row?.installed ? "ready" as const : !rows ? "unknown" as const : !row ? "unavailable" as const : row.installing ? "installing" as const : row.kind === "guide" ? "manual" as const : "missing" as const;
  return { state, name: builtin ?? row?.name ?? id, description: builtin ? "应用内置" : row?.description, size: row?.size };
}
