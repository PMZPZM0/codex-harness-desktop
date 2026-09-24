/**
 * handleEventRouter2 —— 01-seg 里那条事件总路由的第 2 个分支体（09-22 纯搬迁）。
 * ⛔ 语义等价要点：原体里的 `return` 是**从 onEvent 回调退出**；本函数把它改成 `return true`，
 *    调用处 `if (handleN(...)) return;` —— 提前退出的效果逐位保留（回调的返回值本来就被丢弃）。
 */
import "@xterm/xterm/css/xterm.css";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";
import { createToolCallDedupe } from "../../../../../lib/tool-call-dedupe.mjs";

/** ⛔ 同一个 tool call 只执行一次（09-22 实测：一次 subagent_invoke 被渲染层执行 7 次 →
 *  7 个同名会话、每个约 1MB rollout、query 逐字相同 ⇒ 7 倍 token）。重复到达复用首次结果。 */
const toolCallDedupe = createToolCallDedupe();

/** 工具调用回包（带缓存）：重复到达时用同一份结果补发 —— 引擎重发往往就是因为它没收到第一次的 respond */
const toolCallRespond = (() => {
  const cache = new Map<string, unknown>();
  return {
    send: (id: string | number, payload: unknown) => { cache.set(String(id), payload); return window.codex.respond(id, payload); },
    resend: (id: string | number) => { const payload = cache.get(String(id)); return payload === undefined ? Promise.resolve() : window.codex.respond(id, payload); },
  };
})();

export function handleEventRouter2(bag: Bag, event: any): boolean {
        if (event.method === "currentTime/read") {
          void toolCallRespond.send(event.id, { currentTimeAt: Math.floor(Date.now() / 1000) });
          return true;
        }
        if (event.method === "item/tool/call") {
          void toolCallDedupe.run(event.id, async () => {
            try {
              const args = typeof event.params?.arguments === "string" ? JSON.parse(event.params.arguments) : event.params?.arguments ?? {};
              if (event.params?.tool === "memory_recall") {
                const result = bag.workspaceMemoryEnabled ? await window.codex.recallMemory(String(args.query ?? ""), bag.workspace) : { context: "", remote: false };
                await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: result.context || "没有找到相关记忆" }], success: true });
              } else if (event.params?.tool === "memory_save") {
                const cat = String(args.category ?? "临时上下文");
                const result = await window.codex.saveMemory({ category: cat, content: args.content ?? "", sourceThreadId: event.params?.threadId, workspace: bag.workspace, pinned: cat === "项目背景" || cat === "工作流/SOP" });
                bag.showToast("已记住", `${cat}：${String(args.content ?? "").slice(0, 60)}（记忆中心可查看 / 跳回本会话）`);
                await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `记忆已保存：${result.id}` }], success: true });
              } else if (event.params?.tool === "identity_onboard") {
                // 首次见面引导落盘：全部维度写个性化档案（助手名/称呼/场景/职业/风格/语气/爱好/习惯 + onboarded），
                // AGENTS.md 即时重建——之后所有新会话都不再注入引导。
                try {
                  const assistantName = String(args.assistantName ?? "").trim();
                  await window.codex.saveIdentity({
                    assistantName,
                    userName: String(args.userName ?? "").trim(),
                    about: String(args.about ?? "").trim(),
                    occupation: String(args.occupation ?? "").trim(),
                    replyStyle: String(args.replyStyle ?? "").trim(),
                    tone: String(args.tone ?? "").trim(),
                    interests: String(args.interests ?? "").trim(),
                    habits: String(args.habits ?? "").trim(),
                  });
                  bag.setIdentityGreeted(true);
                  bag.showToast(assistantName ? `你好，${assistantName}！` : "用户中心已建立", assistantName ? "这个名字已经正式归你啦，以后新会话都会用它" : "初次见面档案已保存，后续新会话不再出现");
                  await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: "用户中心档案已保存并全局生效（含称呼/场景/风格/爱好等维度）。请热情确认一句后结束引导。" }], success: true });
                } catch (error: any) {
                  await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `保存失败：${error.message}` }], success: false });
                }
              } else if (event.params?.tool === "subagent_invoke") {
                bag.setSubAgentRunning(String(args.name ?? ""));
                try {
                  const result = await window.codex.invokeSubAgent({
                    name: String(args.name ?? ""),
                    query: String(args.query ?? ""),
                    cwd: bag.workspace || undefined,
                    model: bag.selectedModel?.model ?? modelName(bag.modelId),
                    effort: bag.effort || undefined,
                    sandbox: bag.sandbox,
                    approvalPolicy: bag.approvalPolicy,
                  });
                  await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `[子智能体 ${result.name} 的执行结果]\n${result.output}` }], success: true });
                } finally {
                  bag.setSubAgentRunning(null);
                }
              }
              // ⛔ agent_invoke / agent_archive_sessions 的动态工具分支已删（09-16）：
              //    两者改走内置 MCP（harness-dispatch），调用由主进程 HTTP 执行端直接处理，
              //    不再经渲染层 dynamicToolCall 事件回流。
              else if (event.params?.tool === "team_member_invoke") {
                await bag.invokeTeamMember(args, String(event.params?.threadId ?? ""), event.id!);
              } else if (event.params?.tool === "team_phase_invoke") {
                // 并行阶段：一次提交多名成员，宿主并发执行（Promise.all 同时发起）后一起返回
                await bag.invokeTeamPhase(Array.isArray(args.tasks) ? args.tasks : [], String(event.params?.threadId ?? ""), event.id!);
              } else if (event.params?.tool === "generate_image") {
                const cfg: any = await window.codex.readBuiltinPlugins().catch(() => null);
                const c = cfg?.image;
                if (!c?.baseUrl || !c?.apiKey || !c?.model) {
                  await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: "生图插件未配置：请到 设置 → 插件 → 内置插件 填写 API 地址、密钥和模型。" }], success: false });
                } else {
                  try {
                    const result = await window.codex.generateImage({ baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, prompt: String(args.prompt ?? "") });
                    // ⛔ 这段文本是**进对话历史**的，只能带路径或短托管地址，绝不能带 data URL：
                    //    09-21 实测它曾等于单条 3.03 MB 的 base64 文本、且每轮重发
                    //    （见 electron/main.ts 的 persistGeneratedImage）。给用户看走 markdown 图片语法。
                    const text = result.path
                      ? `图片已生成，本地文件：${result.path}\n展示给用户请用 markdown 图片语法引用该路径（![描述](路径)）；需要看图片内容用 view_image 传该路径。`
                      : result.url
                        ? `图片已生成（网关托管地址，可能很快失效）：${result.url}`
                        // 走到这里只剩一种可能：网关只回了内联 base64、而落盘失败了 —— 别报成
                        // 「没生成」（图其实生成了），否则用户会以为白等一场。
                        : "图片已生成，但保存到本地失败（磁盘空间或权限问题）。请检查应用数据目录下的 images 目录后重试。";
                    await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text }], success: Boolean(result.path || result.url) });
                  } catch (error: any) {
                    await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: "生图失败：" + error.message }], success: false });
                  }
                }
              } else if (event.params?.tool === "describe_image") {
                const cfg: any = await window.codex.readBuiltinPlugins().catch(() => null);
                const c = cfg?.vision;
                if (!c?.baseUrl || !c?.apiKey || !c?.model) {
                  await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: "视觉辅助插件未配置：请到 设置 → 插件 → 内置插件 填写视觉模型 API 地址、密钥和模型。" }], success: false });
                } else {
                  try {
                    const result = await window.codex.describeImage({ baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, imageUrl: String(args.imageUrl ?? ""), prompt: args.prompt ? String(args.prompt) : undefined });
                    await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: "[视觉辅助模型识别结果]\n" + (result.text || "（视觉模型未返回描述）") }], success: Boolean(result.text) });
                  } catch (error: any) {
                    await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: "识图失败：" + error.message }], success: false });
                  }
                }
              } else if (event.params?.tool === "rpa_save") {
                const result = await window.codex.saveRpaRecipe({ name: String(args.name ?? ""), desc: String(args.desc ?? ""), kind: String(args.kind ?? "browser"), steps: (Array.isArray(args.steps) ? args.steps : [String(args.steps ?? "")]).map(String), target: args.target ? String(args.target) : undefined, workspace: bag.workspace || undefined });
                bag.showToast("RPA 配方已保存", `「${result.name}」共 ${result.steps.length} 步，可在 设置 → RPA 自动化 里管理`);
                await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `RPA 配方「${result.name}」已保存（${result.steps.length} 步，${result.kind}）。下次说"运行 ${result.name}"即可复用。` }], success: true });
              } else if (event.params?.tool === "rpa_run") {
                if (!args.name) {
                  const list = await window.codex.listRpaRecipes();
                  const text = list.length ? list.map((r: any) => `- ${r.name}（${r.kind === "browser" ? "浏览器" : r.kind === "desktop" ? "桌面" : "混合"}，${r.steps.length} 步${r.lastStatus ? `，上次：${r.lastStatus === "ok" ? "成功" : `失败：${r.lastError ?? ""}`}` : ""}）：${r.desc ?? ""}`).join("\n") : "还没有保存任何 RPA 配方。";
                  await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `[RPA 配方清单]\n${text}` }], success: true });
                } else {
                  const list = await window.codex.listRpaRecipes();
                  const recipe = list.find((r: any) => r.name === String(args.name)) ?? list.find((r: any) => String(args.name).includes(r.name));
                  if (!recipe) {
                    await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `没有找到名为「${args.name}」的配方。可用：${list.map((r: any) => r.name).join("、") || "（空）"}` }], success: false });
                  } else {
                    bag.setRpaRunning(recipe.id);
                    try {
                      const stepsText = recipe.steps.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n");
                      await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `[RPA 配方「${recipe.name}」开始执行，共 ${recipe.steps.length} 步]\n${stepsText}\n请严格按以上步骤逐步执行自动化操作${recipe.target ? `（目标：${recipe.target}）` : ""}，完成后报告每步结果。` }], success: true });
                      window.codex.recordRpaRun({ id: recipe.id, ok: true }).catch(() => undefined);
                    } catch (error: any) {
                      window.codex.recordRpaRun({ id: recipe.id, ok: false, error: error.message }).catch(() => undefined);
                      throw error;
                    } finally {
                      bag.setRpaRunning(null);
                    }
                  }
                }
              } else if (event.params?.tool === "task_add") {
                const task = await window.codex.addTask({ text: String(args.text ?? ""), priority: String(args.priority ?? "medium") });
                bag.showToast("已加入任务清单", task.text);
                // ⛔ 必须同步渲染层状态：taskList 原本只在应用启动时拉一次（useEffect []），
                //    agent 建完清单前端完全不知道 → 「让 Codex 创建任务清单也没展示出来」（09-15 实测）
                void window.codex.listTasks().then(bag.setTaskList).catch(() => undefined);
                await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `已加入任务清单：${task.text}（优先级：${task.priority}）` }], success: true });
              } else if (event.params?.tool === "task_update") {
                if (!args.id && args.status === undefined && args.text === undefined && !args.done) {
                  const tasks = await window.codex.listTasks();
                  bag.setTaskList(tasks);
                  const text = tasks.length ? tasks.map((t: any) => `- [${t.status === "done" ? "x" : " "}] ${t.text}（${t.priority}${t.status === "doing" ? "，进行中" : t.status === "done" ? "，已完成" : ""}）id:${t.id}`).join("\n") : "任务清单为空。";
                  await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `[任务清单]\n${text}` }], success: true });
                } else if (args.done) {
                  await window.codex.deleteTask(String(args.id));
                  void window.codex.listTasks().then(bag.setTaskList).catch(() => undefined);
                  await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: "任务已删除。" }], success: true });
                } else {
                  const patch: any = {};
                  if (args.status) patch.status = String(args.status);
                  if (args.text) patch.text = String(args.text);
                  if (args.priority) patch.priority = String(args.priority);
                  const task = await window.codex.updateTask({ id: String(args.id), patch });
                  void window.codex.listTasks().then(bag.setTaskList).catch(() => undefined);
                  await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `任务已更新：${task.text} → ${task.status}` }], success: true });
                }
              } else if (event.params?.tool === "agent_ask") {
                const question = String(args.question ?? "请选择：");
                const options: string[] = Array.isArray(args.options) ? args.options.map(String) : [];
                const askThreadId = String(event.params?.threadId ?? bag.threadRef.current?.id ?? "");
                const isCurrentThread = askThreadId && askThreadId === bag.threadRef.current?.id;
                // 不再跨会话弹窗：当前会话内贴输入框上方展示；用户在别的会话时先通知，切回会话再看到卡片
                if (!isCurrentThread) {
                  bag.showToast("Agent 有问题等你回答", `${question.slice(0, 60)}${question.length > 60 ? "…" : ""}（会话：${bag.threads.find((entry) => entry.id === askThreadId)?.name ?? "后台任务"}）`);
                }
                const answer = await new Promise<string>((resolve) => bag.setAgentAsk({ threadId: askThreadId, question, options, recommended: options[0] ?? null, allowFree: args.allowFree !== false, resolve }));
                // ESC 关闭问答卡时 answer 为空串：明确告知引擎用户跳过了选择，避免它等一个不存在的选项
                await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: answer ? `[用户选择] ${answer}` : "[用户取消了选择] 请继续其它工作，或稍后换一种方式再问。" }], success: true });
              } else if (event.params?.tool === "skill_search") {
                const query = String(args.query ?? "").trim();
                const [market, local] = await Promise.all([
                  window.codex.listMarketSkills({ query }).catch(() => null),
                  window.codex.listLocalSkills().catch(() => []),
                ]);
                const installedNames = new Set((local as any[]).map((s: any) => normSkillName(s.name)));
                const rows = (market?.items ?? []).slice(0, 6).map((s: any) => `- ${s.name}｜${String(s.description ?? "").slice(0, 80)}｜${installedNames.has(normSkillName(s.name)) ? "已安装" : "未安装"}`);
                const text = rows.length
                  ? `技能市场「${query}」搜索结果：\n${rows.join("\n")}\n要装哪条就调 skill_install 并把 query 传它的准确名称。`
                  : `技能市场没有搜到「${query}」相关技能。请手工完成本任务，并在回复末尾加一行「💡 未找到合适技能：${query}」。`;
                await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text }], success: true });
              } else if (event.params?.tool === "skill_install") {
                const query = String(args.query ?? "").trim();
                const market = await window.codex.listMarketSkills({ query }).catch(() => null);
                const target = (market?.items ?? []).find((s: any) => normSkillName(s.name) === normSkillName(query)) ?? (market?.items ?? [])[0];
                if (!target) {
                  await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `技能市场没有「${query}」的匹配技能。请手工完成本任务，并在回复末尾加一行「💡 未找到合适技能：${query}」。` }], success: true });
                } else {
                  const r = await window.codex.installMarketSkillLight(target);
                  bag.showToast("技能已自主安装", `${r.name}（${r.discovered ? "引擎已发现" : "下回合生效"}）`);
                  await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `技能「${r.name}」已安装（市场来源，已通过安全校验）。${r.engineCheckMessage}。现在请先读它的 SKILL.md（skills 目录下同名文件夹），严格按说明书使用。` }], success: true });
                }
              } else if (event.params?.tool === "connector_search") {
                const query = String(args.query ?? "").trim();
                const [templates, configured] = await Promise.all([
                  window.codex.listConnectorTemplates(),
                  window.codex.listConnectors().catch(() => []),
                ]);
                const configuredIds = new Set((configured as any[]).map((c: any) => c.id));
                const rows = (templates as any[])
                  .filter((t: any) => !query || `${t.name}${t.summary}`.toLowerCase().includes(query.toLowerCase()))
                  .slice(0, 8)
                  .map((t: any) => `- ${t.id}｜${t.name}｜${String(t.summary ?? "").slice(0, 70)}｜${configuredIds.has(t.id) ? "已配置" : "未配置"}${(t.fields ?? []).some((f: any) => f.secret) ? "（需凭据）" : ""}`);
                const text = rows.length
                  ? `内置 MCP 连接器模板：\n${rows.join("\n")}\n要装某条：先用 agent_ask 征得用户同意，再调 connector_install 传它的 id（安装会重启引擎并中断当前回合）。`
                  : "没有匹配的内置连接器模板。请手工完成，或建议用户在 设置 → 连接器 里自定义。";
                await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text }], success: true });
              } else if (event.params?.tool === "connector_install") {
                const templateId = String(args.templateId ?? "").trim();
                const templates = await window.codex.listConnectorTemplates();
                const template = templates.find((t: any) => t.id === templateId);
                if (!template) {
                  await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `没有 id 为「${templateId}」的连接器模板。请先调 connector_search 查询。` }], success: false });
                } else {
                  const draft: ConnectorDraft = { id: template.id, name: template.name, transport: template.transport, command: template.command, args: template.args, url: template.url };
                  await window.codex.saveConnector(draft);
                  bag.showToast("连接器已安装", template.name);
                  await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `MCP 连接器「${template.name}」已配置并生效（引擎已重启，当前回合已中断）。请告诉用户：重新发一条消息即可继续，该连接器的工具已可直接使用。` }], success: true });
                }
              } else {
                await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `Dynamic tool ${event.params?.tool ?? "unknown"} is not registered by this harness.` }], success: false });
              }
            } catch (error: any) {
              await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `${event.params?.tool === "subagent_invoke" ? "子智能体调用失败" : "记忆工具失败"}：${error.message}` }], success: false });
            }
          }).then((duplicate) => {
            // ⛔ 重复到达也必须回包：引擎重发往往就是因为它没收到第一次的 respond，
            //    吞掉它会让该 tool call 永久 pending（用户看到转圈不停、只能手动中断）
            if (duplicate) void toolCallRespond.resend(event.id);
          }).catch(() => undefined);
          return true;
        }
        bag.setPending((current) => current.some((entry) => entry.id === event.id) ? current : [...current, { id: event.id!, method: event.method!, params: event.params }]);
        return true;
      
  return false;
}
