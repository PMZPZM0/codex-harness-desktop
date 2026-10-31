/** 把引擎 item 压成手机端能看懂的一行步骤（返回空串 = 这一步不上报）。
 *  叶子模块：boot.ts（实时转发）与 main.ts（历史回放）共用同一套文案，避免两处各写一份。 */
export function remoteStepOf(item: any, phase: "started" | "completed"): string {
  const type = String(item?.type ?? "");
  if (phase === "completed") return "";
  if (type === "commandExecution") {
    const cmd = String(item?.command ?? "").replace(/\s+/g, " ").trim();
    return cmd ? `命令 · ${cmd.slice(0, 60)}` : "命令";
  }
  // 文件变更不在这里报：引擎的 fileChange 不带行数，改由宿主追踪器的 live 报告（kind:"files"）
  if (type === "mcpToolCall" || type === "dynamicToolCall" || type === "functionCall") {
    /* 与桌面工具卡同口径：带 server 前缀 + 参数摘要（截断），手机端至少能看出「调了什么、传了什么」 */
    const server = String(item?.server ?? "").slice(0, 24);
    const tool = String(item?.tool ?? item?.name ?? "工具").slice(0, 48);
    let args = "";
    try {
      if (item?.arguments) args = JSON.stringify(item.arguments).replace(/\s+/g, " ").slice(0, 80);
    } catch { args = ""; }
    return `工具 · ${server ? `${server}/` : ""}${tool}${args ? ` ${args}` : ""}`;
  }
  if (type === "webSearch") {
    const query = String(item?.query ?? "").slice(0, 40);
    return query ? `搜索 · ${query}` : "搜索";
  }
  // 思考不在这里报一行标签：它有自己的摘要流（kind:"think"），内容实时可见
  return "";
}
