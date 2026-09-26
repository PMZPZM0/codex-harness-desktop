/**
 * delegation（09-21 架构改造：从 electron/main.ts 组合根按符号拆出，纯搬迁）
 *
 * 搬出符号：runDelegatedTask
 *
 * 代码与原地逐字一致（仅顶部 import + 文件头注释）。
 * 跨域符号经 `import … from "../main"` 取用 —— **活绑定**（TS→CJS 编译成 `main_1.X` 属性访问）。
 * 会被重新赋值的符号经 `mutableState` 访问器读写（ESM 里 import 的绑定不可赋值）。
 */
import { canDispatchFrom, clipDispatchOutput, delegateScopeBlock, kindLabel, resolveDispatchTarget } from "../dispatch";
import { buildTeamPhaseTool, buildTeamSystemPrompt, buildTeamTools, readExpertTeams } from "../expert-teams";
import { safeStorage } from "electron";
import { safeProviderId } from "../provider-id";
import { PROVIDER_RETRY_TUNING } from "../provider-retry";
import { buildDelegateMemory } from "../delegate-memory";
import { broadcastHarnessEvent } from "../features/window-bus";
import type { DispatchKind } from "../dispatch";
import { buildDispatchCatalog, restrictedThreadRole } from "../features/dispatch-core";
import { readCustomModel } from "../main/01-model-catalog";
import { turnOutputText, waitForTurnCompletion } from "../main/03-turn-summary";
import { readSubAgents } from "../main/09-agents-plugins";
import { delegateRegistry, server, threadRuntimeStore } from "../runtime-refs";
import { bridgeDial } from "../main";
import { ensureProjectAgentsMd } from "../project-conventions";
export async function runDelegatedTask(input: {
  kind: DispatchKind; name: string; query: string; originThreadId: string;
  cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string;
}): Promise<{ ok: boolean; threadId?: string; name?: string; output: string; error?: string }> {
  const origin = String(input.originThreadId ?? "");
  // ── L3 硬闸：发起方本身是被委派产生的会话 → 一律拒绝（防套娃的最后一道，注册侧漏了也拦住）
  const originRecord = origin ? await delegateRegistry.infoOf(origin) : null;
  // ── 独占锁校验（同一时间只允许一个会话调度）：注册侧不给工具只是「少给一次机会」，
  //    这里才作准 —— 会话被接管、开关被关掉之后，残留的工具调用一律不认。 ──
  const originDispatch = origin ? (await threadRuntimeStore.get(origin))?.dispatch : null;
  // 身份闸：专家 / 专家团 / 被调度的会话一律不许**对外**派人（团内协作走 teams:invoke-member，不受此限）
  const originRestrict = origin ? await restrictedThreadRole(origin) : { restricted: false };
  const gate = canDispatchFrom({
    isDelegated: Boolean(originRecord),
    depth: originRecord?.depth ?? 0,
    holdsLock: originDispatch?.enabled === true,
    restricted: originRestrict.restricted,
    restrictedLabel: originRestrict.label,
  });
  if (!gate.ok) return { ok: false, output: "", error: gate.reason };
  /* ⛔ 原先这里有一道 L4 并发闸（同时进行的调度任务上限，超限就拒）。09-25 用户要求删除并发限制
     ⇒ 移除；一次 fan-out 派多少成员不再受限（后果：更容易撞上游 429，由引擎默认重试兜底）。
     L3 深度闸仍在上面（`canDispatchFrom`）—— 它挡的是调用链无限延长，不是并发数。 */

  const targets = await buildDispatchCatalog();
  const found = resolveDispatchTarget(targets, { kind: input.kind, name: input.name });
  if (!found.target) return { ok: false, output: "", error: found.error };
  const target = found.target;

  // 解析角色提示词与（团队才有的）调度工具
  let rolePrompt = "";
  let displayName = target.name;
  let teamTools: unknown[] = [];
  if (target.kind === "subagent") {
    const subs = await readSubAgents();
    const sub = subs.find((entry) => entry.id === target.key);
    if (!sub) return { ok: false, output: "", error: `子智能体「${input.name}」不存在` };
    rolePrompt = sub.systemPrompt ?? "";
  } else {
    const teams = await readExpertTeams();
    const team = teams.find((entry) => entry.teamId === target.teamId);
    if (!team) return { ok: false, output: "", error: `专家「${input.name}」不存在` };
    if (target.kind === "team") {
      rolePrompt = buildTeamSystemPrompt(team);
      // 主理人靠这两个工具管**本团成员**（团队内部机制，不是对外委派，故不受 L3 限制）
      teamTools = [buildTeamTools(team), buildTeamPhaseTool(team)];
    } else {
      const member = [team.lead, ...team.members].find((m) => m.id === target.memberId);
      if (!member) return { ok: false, output: "", error: `成员「${input.name}」不在专家团里` };
      rolePrompt = member.systemPrompt ?? "";
      displayName = target.kind === "expert" ? team.displayName.zh : `${team.displayName.zh}·${member.name}`;
    }
  }

  const customModel = await readCustomModel();
  const provider = customModel?.provider ?? "openai";
  const baseUrl = customModel?.baseUrl;
  const providerName = customModel?.name ?? provider;
  const apiKey = customModel?.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(customModel.encryptedKey, "base64")) : "";
  if (apiKey) server.setApiKey(apiKey);
  const effectiveModel = input.model || customModel?.model;
  if (!effectiveModel) return { ok: false, output: "", error: "尚未配置模型，无法发起调度" };

  ensureProjectAgentsMd(input.cwd || process.cwd());
  const started: any = await server.request("thread/start", {
    model: effectiveModel,
    cwd: input.cwd || process.cwd(),
    approvalPolicy: input.approvalPolicy || "never",
    sandbox: input.sandbox || "workspace-write",
    modelProvider: provider,
    config: baseUrl ? { model_provider: safeProviderId(provider), model_providers: { [safeProviderId(provider)]: { name: providerName, base_url: bridgeDial(provider, baseUrl), env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } } : undefined,
    ...(teamTools.length ? { dynamicTools: teamTools } : {}),
  });
  const threadId = String(started?.thread?.id ?? "");
  if (!threadId) return { ok: false, output: "", error: "调度会话创建失败（未返回 threadId）" };
  try { await server.request("thread/name/set", { threadId, name: `调度·${displayName}`.slice(0, 40) }); } catch { /* 命名失败不阻塞 */ }

  // ── L1：给被委派会话下发**会话级持久指令**（直接干活、不要转派）。
  //    刻意走持久指令而不是塞在首条消息里：成员会话/被调会话可能被复用、也可能被用户点开继续问，
  //    写在单条消息里会被历史淹没、压缩后丢失。
  try {
    const baseRead: any = await server.request("config/read", {}).catch(() => null);
    const baseInstructions = String(baseRead?.config?.developer_instructions ?? "");
    const block = delegateScopeBlock({ kind: target.kind, name: displayName, origin });
    const merged = baseInstructions ? `${baseInstructions}\n\n---\n\n${block}` : block;
    await server.request("thread/settings/update", {
      threadId,
      collaborationMode: { mode: "default", settings: { model: effectiveModel, developer_instructions: merged } },
    }).catch(() => undefined);
  } catch { /* 下发失败不阻塞执行：L3 硬闸仍在主进程把关 */ }

  const record = await delegateRegistry.register({ threadId, originThreadId: origin, kind: target.kind, name: displayName, depth: (originRecord?.depth ?? 0) + 1 });
  broadcastHarnessEvent({ type: "delegates-changed", threadId } as any);
  // 右侧「调度头像轨」：开始即点亮头像（弹窗打开后能看到实时产出流）
  broadcastHarnessEvent({ type: "delegate-run", phase: "started", threadId, record, at: Date.now() } as any);

  /* 被委派会话也要有记忆（09-23 用户：「子智能体跟专家团都有没有记忆板块跟功能，没有就完善好」）。
     ⛔ 主会话的记忆是在**渲染层发送路径**拼的（send.tsx），而委派回合由主进程直接 turn/start
     ⇒ 不在这里补，子智能体 / 专家 / 专家团主理人 / 成员就永远读不到常驻记忆与召回条目。
     口径 / 门禁 / 三条硬约束见 electron/delegate-memory.ts（守卫【125】）。 */
  /* ⛔ 09-24（评估报告 §4.3）：这一句位于 register() 之后、try 之前 —— 一旦抛出，
     刚注册的 status="running" 记录就再没人收敛（下面的 catch 只覆盖 turn 段），
     与启动自愈（delegate-registry.reconcileRunning）配套：这里也必须降级而不是抛出。
     buildDelegateMemory 内部已对两次记忆读取做了 catch，这是最后一道（同步路径）。
     记忆只是增强，读不到不该让整次委派失败。 */
  const delegateMemory = await buildDelegateMemory({
    workspace: input.cwd,
    query: String(input.query ?? ""),
    originThreadId: origin,
  }).catch((): { text: string } => ({ text: "" }));

  const finalQuery = [
    "[SYSTEM TASK · 调度会话]",
    "=== 用户需求 ===",
    `发起方交给你的任务：${String(input.query ?? "").trim()}`,
    "=== END ===",
    "",
    `[角色：${kindLabel(target.kind)} ${displayName}]`,
    rolePrompt,
    "",
    "直接执行上面的任务并给出最终产出（关键结论 + 依据 + 建议）。你的最终回答文本会被完整回传给发起方，无需调用任何回传工具。不要发起破坏性操作。",
  ].join("\n") + delegateMemory.text;

  try {
    const turn: any = await server.request("turn/start", {
      threadId,
      input: [{ type: "text", text: finalQuery, text_elements: [] }],
      model: effectiveModel,
      effort: input.effort || undefined,
    });
    const turnId = turn?.turn?.id;
    if (!turnId) throw new Error("调度失败：未返回 turnId");
    const completed = await waitForTurnCompletion(threadId, turnId);
    let output = turnOutputText(completed);
    if (!output) {
      const resumed: any = await server.request("thread/resume", { threadId, excludeTurns: false }).catch(() => null);
      output = turnOutputText(resumed?.thread?.turns?.find((entry: any) => entry.id === turnId));
    }
    const text = clipDispatchOutput(output || `（${displayName} 没有返回文本内容）`, threadId);
    // 标题在 turn 之后**再设一次**：首条消息会覆盖会话标题（引擎拿首条用户消息当 title），
    // 只在 turn 之前设的话侧栏会显示成 `[SYSTEM TASK · 调度会话]` 那一坨（09-15 验收实测）。
    try { await server.request("thread/name/set", { threadId, name: `调度·${displayName}`.slice(0, 40) }); } catch { /* 命名失败不影响产出回传 */ }
    await delegateRegistry.setOutput(threadId, text);
    await delegateRegistry.markStatus(threadId, "done");
    broadcastHarnessEvent({ type: "delegates-changed", threadId } as any);
    // 头像轨收场：跑完即从右侧消失（用户 09-16：「调用完就不展示头像了」）；广播终态供弹窗收起与兜底渲染
    broadcastHarnessEvent({ type: "delegate-run", phase: "finished", threadId, status: "done", output: text, at: Date.now() } as any);
    return { ok: true, threadId, name: displayName, output: text };
  } catch (error: any) {
    const message = error?.message ?? String(error);
    await delegateRegistry.setOutput(threadId, "").catch(() => undefined);
    await delegateRegistry.markStatus(threadId, "failed", { error: message }).catch(() => undefined);
    broadcastHarnessEvent({ type: "delegates-changed", threadId } as any);
    broadcastHarnessEvent({ type: "delegate-run", phase: "finished", threadId, status: "failed", error: message, at: Date.now() } as any);
    return { ok: false, threadId, name: displayName, output: "", error: message };
  }
}
