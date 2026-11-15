/**
 * PhotoCraft 工具的分发体（11-15）—— 从 event-router 拆出，避免主路由文件继续膨胀。
 * ⛔ 只做「工具参数 → IPC 调用 → 文本回执」；文件/命令校验全在 features/photocraft-ipc.ts。
 */
type Step = { id?: string; params?: Record<string, unknown> };

/** 跑一次 photocraft 工具调用，返回给模型的文本与 success。 */
export async function runPhotoCraftTool(rawArgs: Record<string, unknown>): Promise<{ text: string; success: boolean }> {
  const args = rawArgs ?? {};
  const action = String(args.action ?? "status");
  const steps = Array.isArray(args.commands) ? (args.commands as Step[]) : [];
  try {
    if (action === "status") {
      const st = await window.codex.photocraftStatus();
      if (!st?.installed) {
        return { text: "PhotoCraft 还没安装：请到「设置 → 开发工具 → PhotoCraft 图像编辑」点安装（约 137MB，镜像序 + SHA256 校验；Windows 含 CLI+GUI）。", success: false };
      }
      const text = [
        `PhotoCraft：已安装${st.version ? ` v${st.version}` : ""} · ${Math.round(Number(st.sizeBytes ?? 0) / 1048576)} MB`,
        `CLI：${st.cliPath || "（缺失）"}`,
        `GUI：${st.guiPath || "（本平台只随 CLI；mac 请用官方 dmg）"}`,
        `MCP 连接器：${st.mcpRegistered ? "已写入 config.toml（重启引擎后可用）" : "未注册"} · 收发目录 ${st.ioRoot}`,
        `许可：${st.attribution?.license ?? ""} · ${st.attribution?.home ?? ""}`,
      ].join("\n");
      return { text, success: true };
    }
    if (action === "commands") {
      const r = await window.codex.photocraftCommands({ filter: typeof args.filter === "string" ? args.filter : undefined });
      const lines = (r.items ?? []).map((item) => `${item.id ?? "?"} — ${item.label ?? ""}`);
      return {
        text: `共 ${r.total} 条命令${r.total > lines.length ? `（显示前 ${lines.length} 条，用 filter 收紧）` : ""}。跑命令用 action=run，commands 传 [{id, params}]。\n${lines.join("\n")}`,
        success: true,
      };
    }
    if (action === "info") {
      const info = await window.codex.photocraftInfo({ path: String(args.path ?? "") });
      return { text: JSON.stringify(info).slice(0, 12000), success: true };
    }
    if (action === "run") {
      const r = await window.codex.photocraftRun({ path: String(args.path ?? ""), out: String(args.out ?? ""), commands: steps });
      return {
        text: `已处理并保存：${r.path}\n命令：${(r.commands ?? []).join(" → ")}${(r.log ?? []).length ? `\n${(r.log ?? []).join("\n")}` : ""}`,
        success: true,
      };
    }
    if (action === "convert") {
      const r = await window.codex.photocraftConvert({
        path: String(args.path ?? ""),
        out: String(args.out ?? ""),
        quality: typeof args.quality === "number" ? args.quality : undefined,
      });
      return { text: `已转换：${r.path}`, success: true };
    }
    if (action === "batch") {
      const r = await window.codex.photocraftBatch({
        input: String(args.input ?? ""),
        outDir: String(args.outDir ?? ""),
        commands: steps,
        format: typeof args.format === "string" ? args.format : undefined,
        recursive: args.recursive === true,
      });
      return { text: `批量完成：${(r.commands ?? []).join(" → ")} → ${r.outDir}`, success: true };
    }
    if (action === "open") {
      const r = await window.codex.photocraftOpen({ path: typeof args.path === "string" ? args.path : undefined });
      return { text: r?.ok ? "已用 PhotoCraft 窗口打开。" : `打开失败：${r?.error ?? "未知原因"}`, success: r?.ok === true };
    }
    return { text: `未知 action：${action}（可用：status / commands / info / run / convert / batch / open）`, success: false };
  } catch (error) {
    return { text: `PhotoCraft 执行失败：${(error as Error)?.message ?? String(error)}`, success: false };
  }
}
