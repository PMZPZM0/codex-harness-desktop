/**
 * Craft 全家桶独立工具 `craft_<id>` 的分发体（11-16）。
 * ⛔ 只做「工具参数 → artcraft:run → 文本回执」；路径闸 / 命令校验都在 features/artcraft-ipc.ts。
 */
type Step = { id?: string; params?: Record<string, unknown> };

/** 跑一次某个 Craft App 的独立工具，返回给模型的文本与 success。 */
export async function runCraftAppTool(appId: string, rawArgs: Record<string, unknown>): Promise<{ text: string; success: boolean }> {
  const args = rawArgs ?? {};
  const action = String(args.action ?? "status");
  const steps = Array.isArray(args.commands) ? (args.commands as Step[]) : [];
  try {
    const result = await window.codex.artcraftRun({
      app: appId,
      action,
      path: typeof args.path === "string" ? args.path : undefined,
      out: typeof args.out === "string" ? args.out : undefined,
      commands: steps,
      filter: typeof args.filter === "string" ? args.filter : undefined,
      quality: typeof args.quality === "number" ? args.quality : undefined,
    });
    const text = String(result?.text ?? "").trim() || (result?.ok ? "完成" : "失败（无输出）");
    return { text, success: result?.ok !== false };
  } catch (error) {
    return { text: `${appId} 执行失败：${(error as Error)?.message ?? String(error)}`, success: false };
  }
}
