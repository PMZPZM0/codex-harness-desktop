/** fmtImportNote（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export function fmtImportNote(p: PendingImportPayload): string {
  return `来源文件：${p.fileName} ｜ 原会话：${p.title || "未命名"} ｜ ${p.turns ? `${p.turns} 条消息` : "消息轮次未知"} ｜ 导入于 ${fmtImportTime(p.at)}`;
}

function fmtImportTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return iso; }
}
