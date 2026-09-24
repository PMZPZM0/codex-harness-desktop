/** itemStatusLabel（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export function itemStatusLabel(status: unknown) {
  if (status === "inProgress" || status === "running") return "处理中";
  if (status === "failed" || status === "error") return "失败";
  if (status === "declined") return "已拒绝";
  if (status === "interrupted") return "已中断";
  return "已处理";
}
