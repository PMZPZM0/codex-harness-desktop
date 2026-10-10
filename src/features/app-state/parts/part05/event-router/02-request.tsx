/**
 * handleEventRouter2 —— 01-seg 里那条事件总路由的第 2 个分支体（09-22 纯搬迁）。
 * ⛔ 语义等价要点：原体里的 `return` 是**从 onEvent 回调退出**；本函数把它改成 `return true`，
 *    调用处 `if (handleN(...)) return;` —— 提前退出的效果逐位保留（回调的返回值本来就被丢弃）。
 */
import "@xterm/xterm/css/xterm.css";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";
import { createToolCallDedupe } from "../../../../../lib/tool-call-dedupe.mjs";
/* 前端开发（10-05，两轮改名：界面草图 → 手机前端UI → 前端开发）：Codex 读写画布走**对方域的 barrel**（域↔域的唯一接口面）。
   会话单例在 ui-sketch 那边持有（iframe 由弹窗 attach），这里只发请求。 */
import { applySketchDoc, requestSketchDoc, summarizeDoc, validateSketchDoc, waitSketchReady } from "../../../../ui-sketch";

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
                /* ⛔ 10-05 统一记忆（检索）：**走同一个通道、同一套作用域** ——
                   改造前这里只查碎片池（且那个池子跨工作区只降权、不过滤），
                   与新的写入面脱节 ⇒ 写进去的条目召不回来。
                   ⛔ 保留 fragments 那条兜底：碎片池里可能有历史条目。 */
                const query = String(args.query ?? "");
                const result = bag.workspaceMemoryEnabled
                  ? await window.codex.readRoleMemoryContext({
                      threadId: String(event.params?.threadId ?? bag.threadRef.current?.id ?? ""),
                      workspace: bag.workspace || "",
                      query,
                    })
                  : { text: "", key: "", counts: { project: 0, session: 0, legacy: 0 } };
                const text = result?.text?.trim() || (await window.codex.recallMemory(query, bag.workspace || undefined)).context || "没有找到相关记忆";
                await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text }], success: true });
              } else if (event.params?.tool === "memory_write" || event.params?.tool === "memory_save") {
                /* ⛔⛔ 10-05 统一记忆（写）：主会话与被调度角色**同一个内核**
                   （主进程 memory-fabric 的 handleFabricWrite）。
                   ⛔ 旧名 `memory_save` 走同一分支（别名期）—— 不是两套能力。
                   ⚠️ scope=project 从这里写**不需要 promote**：主会话就是项目的主人；
                      角色会话的 promote 闸在主进程应答路径（boot.ts），那里才有身份硬闸。 */
                const cat = String(args.category ?? "临时上下文");
                const scope = args.scope === "project" ? "project" : "session";
                const result = await window.codex.writeFabricMemory({
                  threadId: String(event.params?.threadId ?? bag.threadRef.current?.id ?? ""),
                  workspace: bag.workspace || "",
                  scope,
                  category: cat,
                  content: String(args.content ?? ""),
                  weight: typeof args.weight === "number" ? args.weight : undefined,
                  pinned: args.pinned === true,
                });
                if (result?.ok) {
                  bag.showToast("已记住", `${scope === "project" ? "项目记忆" : "本会话记忆"}：${String(args.content ?? "").slice(0, 60)}`);
                }
                await toolCallRespond.send(event.id!, {
                  contentItems: [{ type: "inputText", text: result?.ok ? result.text : `没有写入：${result?.text ?? "未知原因"}` }],
                  success: result?.ok === true,
                });
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
              }
              // ⛔⛔ 调度工具走**渲染层注册的 dynamicTool**（10-05 改回；根因见 part08/01-seg.tsx
              //    的 buildDynamicTools 注释：引擎 0.157 起内置 MCP 的工具整批被"延迟暴露"，
              //    不进模型工具面 ⇒ 只走 MCP 的通道等于没通道，用户报「调度工具用不了」）。
              //    执行端不在这里另写一套：直接转 IPC，与 MCP 执行端共用 runDelegatedTask 硬闸
              //    （canDispatchFrom 防套娃 + dispatchKindAllowed 按勾选拦 kind）。
              //    ⛔ 发起方身份取**引擎下发的** event.params.threadId（item/tool/call 自带），
              //    模型只能提供 kind/name/query，伪造不了身份。子智能体专用的 subagent_invoke
              //    已整体删除（它与调度开关脱钩、还让专家/专家团永远被绕过），⛔ 不许加回来。
              else if (event.params?.tool === "agent_invoke") {
                const dispatchOrigin = String(event.params?.threadId ?? bag.threadRef.current?.id ?? "");
                // kind 是联合类型：非法值**不硬塞**（先校验再断言，断言因此可证安全），
                // 当场回一条可读的拒绝，而不是让 IPC 抛类型错——模型据此立刻改参数。
                const kindRaw = String(args.kind ?? "");
                const kindArg = (["expert", "team", "member", "subagent"] as const).includes(kindRaw as any)
                  ? (kindRaw as "expert" | "team" | "member" | "subagent")
                  : null;
                const delegated: any = kindArg === null
                  ? { ok: false, error: `kind 必须是 expert / team / member / subagent 之一（收到「${kindRaw}」）` }
                  : await window.codex.invokeAgent({
                    kind: kindArg,
                    name: String(args.name ?? ""),
                    query: String(args.query ?? ""),
                    originThreadId: dispatchOrigin,
                  });
                await toolCallRespond.send(event.id!, {
                  contentItems: [{ type: "inputText", text: delegated?.ok ? String(delegated.output ?? "") : `调度被拒绝：${delegated?.error ?? "未知原因"}` }],
                  success: delegated?.ok === true,
                });
              } else if (event.params?.tool === "agent_archive_sessions") {
                const dispatchOrigin = String(event.params?.threadId ?? bag.threadRef.current?.id ?? "");
                const archived: any = await window.codex.archiveDelegates({
                  threadIds: Array.isArray(args.threadIds) ? args.threadIds.map(String) : [],
                  originThreadId: dispatchOrigin,
                });
                const done = Number(archived?.archived ?? 0);
                const missed = Array.isArray(archived?.failed) ? archived.failed.length : 0;
                await toolCallRespond.send(event.id!, {
                  contentItems: [{ type: "inputText", text: `已归档 ${done} 个调度会话${missed ? `（${missed} 个失败）` : ""}。` }],
                  success: missed === 0,
                });
              } else if (event.params?.tool === "harness_tools") {
                /* ⭐ 能力网关（10-05）：把引擎 0.157 后对模型不可见的内置 MCP 工具面接回来
                   （定时任务 / 知识库 / 组件库 / 视频 / 语音 / 工作流 / 专家管理 / 连接器注册）。
                   ⛔ callerThreadId 取**引擎事件里的 threadId**（`item/tool/call` 自带，模型伪造不了），
                      绝不用 args 里模型自报的值 —— 这批能力里有写操作。 */
                const gatewayCaller = String(event.params?.threadId ?? bag.threadRef.current?.id ?? "");
                const gatewayArgs = args.args && typeof args.args === "object" && !Array.isArray(args.args) ? args.args : {};
                const gateway: any = await window.codex.callDispatchTool({
                  name: String(args.name ?? ""),
                  args: gatewayArgs,
                  callerThreadId: gatewayCaller,
                });
                await toolCallRespond.send(event.id!, {
                  contentItems: [{ type: "inputText", text: gateway?.ok ? String(gateway.output ?? "") : `调用失败：${gateway?.error ?? "未知原因"}` }],
                  success: gateway?.ok === true,
                });
              } else if (event.params?.tool === "team_member_invoke") {
                await bag.invokeTeamMember(args, String(event.params?.threadId ?? ""), event.id!);
              } else if (event.params?.tool === "team_phase_invoke") {
                // 并行阶段：一次提交多名成员，宿主并发执行（Promise.all 同时发起）后一起返回
                await bag.invokeTeamPhase(Array.isArray(args.tasks) ? args.tasks : [], String(event.params?.threadId ?? ""), event.id!);
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
                const answer = await new Promise<string>((resolve) => bag.setAgentAsk({ threadId: askThreadId, question, options, recommended: options[0] ?? null, allowFree: args.allowFree !== false, multiple: args.multiple === true, resolve }));
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
              } else if (event.params?.tool === "frontend_get_doc") {
                /* 前端开发（10-05）· 读：窗口没开就**自动打开**再等桥就绪 —— dynamicTools 在
                   thread/start 时就把工具名写进了模型工具面，用户未必开着界面窗。
                   ⛔ 等的是"attach + ready"两件事（会话单例判据），不是单看 bag 开关：
                      开关 true 而 iframe 还没挂上时发请求 = 消息发进空气。
                   ⛔ 空画布是**合法结果**（success:true + 指引），不是错误。 */
                if (!bag.uiSketchOpen) bag.setUiSketchOpen(true);
                await waitSketchReady();
                const readback = await requestSketchDoc();
                if (!readback.doc) {
                  await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: "画布当前是空的（没有已保存的设计文档）。可以直接用 frontend_apply_doc 写一份初始文档（例如一个 topAppBar + 一组 listItem 的首页），用户在界面窗口里会实时看到。" }], success: true });
                } else {
                  const summary = summarizeDoc(readback.doc);
                  await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `[前端开发] ${summary.title || "未命名"}：${summary.frames} 屏 / ${summary.items} 部件。以下是完整文档（要在它基础上改就用它，⛔ 别凭记忆重写）：\n${JSON.stringify(readback.doc)}` }], success: true });
                }
              } else if (event.params?.tool === "frontend_apply_doc") {
                /* 前端开发（10-05）· 写：先过**上游同口径**的前置校验（kind/variant/必需字段），
                   再把整份文档交给渲染层会话 → 桥编码成上游分享哈希 → 上游自己落盘（可撤销）。
                   ⛔ 校验失败**不打开窗口**：模型拿着中文原因改一版就能过，比让它盲写、由上游
                      静默拒收（哈希改了画布没动）可解释得多。 */
                let nextDoc: unknown = args.doc;
                if (typeof nextDoc === "string") {
                  try { nextDoc = JSON.parse(nextDoc); } catch { nextDoc = null; }
                }
                const verdict = validateSketchDoc(nextDoc);
                if (!verdict.ok) {
                  await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `设计文档没通过校验：${verdict.reason}。改正后重新调用（建议先 frontend_get_doc 拿现状，在它的基础上改）。` }], success: false });
                } else {
                  if (!bag.uiSketchOpen) bag.setUiSketchOpen(true);
                  await waitSketchReady();
                  const applied = await applySketchDoc(nextDoc);
                  const summary = summarizeDoc(applied.doc ?? nextDoc);
                  await toolCallRespond.send(event.id!, {
                    contentItems: [{ type: "inputText", text: applied.ok
                      ? `已写回画布：${summary.frames} 屏 / ${summary.items} 部件，用户在「前端开发」窗口里实时看到（可继续手绘，也可 Ctrl+Z 撤销）。`
                      : `写回失败：${applied.error || "上游没有应用这份文档（原因未知）"}` }],
                    success: applied.ok,
                  });
                }
              } else if (event.params?.tool === "image_generate") {
                /* ── 图像工坊 · 生图（10-09：走**自己的 IPC** `image-lab:generate`）──────────────────
                   ⛔ 不再经 `harness_tools` 网关，也不再经 `agents:dispatch-call` —— 用户原话
                      「工具区分开，不要共用一个工具」+「把生成和编辑的 IPC 也彻底分开，不要混在一起」。
                   ⛔ threadId 取**引擎事件里的真实值**（模型伪造不了），主进程据此反查会话工作目录，
                      决定图落盘到哪；不许用 args 里模型自报的值。 */
                const gen: any = await window.codex.imageGenerate({
                  prompt: String(args.prompt ?? ""),
                  count: args.count !== undefined ? Number(args.count) : undefined,
                  model: args.model ? String(args.model) : undefined,
                  size: args.size ? String(args.size) : undefined,
                  negative: args.negative ? String(args.negative) : undefined,
                  workspace: args.workspace ? String(args.workspace) : undefined,
                  name: args.name ? String(args.name) : undefined,
                  threadId: String(event.params?.threadId ?? bag.threadRef.current?.id ?? ""),
                });
                await toolCallRespond.send(event.id!, {
                  contentItems: [{ type: "inputText", text: gen?.ok ? String(gen.output ?? "") : `生图失败：${gen?.error ?? "未知原因"}` }],
                  success: gen?.ok === true,
                });
              } else if (event.params?.tool === "image_edit") {
                /* ── 图像工坊 · 修图（`image-lab:edit`，零凭证、本地 jimp）──────────────────── */
                const edited: any = await window.codex.imageEdit({
                  path: args.path ? String(args.path) : undefined,
                  paths: Array.isArray(args.paths) ? args.paths.map(String) : undefined,
                  ops: Array.isArray(args.ops) ? args.ops : [],
                  output: args.output ? String(args.output) : undefined,
                  format: args.format ? String(args.format) : undefined,
                  quality: args.quality !== undefined ? Number(args.quality) : undefined,
                });
                await toolCallRespond.send(event.id!, {
                  contentItems: [{ type: "inputText", text: edited?.ok ? String(edited.output ?? "") : `修图失败：${edited?.error ?? "未知原因"}` }],
                  success: edited?.ok === true,
                });
              } else if (event.params?.tool === "image_info") {
                const info: any = await window.codex.imageInfo({
                  path: args.path ? String(args.path) : undefined,
                  paths: Array.isArray(args.paths) ? args.paths.map(String) : undefined,
                });
                await toolCallRespond.send(event.id!, {
                  contentItems: [{ type: "inputText", text: info?.ok ? String(info.output ?? "") : `读取失败：${info?.error ?? "未知原因"}` }],
                  success: info?.ok === true,
                });
              } else if (event.params?.tool === "image_view") {
                const viewed: any = await window.codex.imageView({
                  path: String(args.path ?? ""),
                  title: args.title ? String(args.title) : undefined,
                });
                await toolCallRespond.send(event.id!, {
                  contentItems: [{ type: "inputText", text: viewed?.ok ? String(viewed.output ?? "") : `预览失败：${viewed?.error ?? "未知原因"}` }],
                  success: viewed?.ok === true,
                });
              } else {
                await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `Dynamic tool ${event.params?.tool ?? "unknown"} is not registered by this harness.` }], success: false });
              }
            } catch (error: any) {
              await toolCallRespond.send(event.id!, { contentItems: [{ type: "inputText", text: `${event.params?.tool ?? "工具"} 调用失败：${error.message}` }], success: false });
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
