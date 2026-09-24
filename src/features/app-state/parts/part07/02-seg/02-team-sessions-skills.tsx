/**
 * usePart07b2 —— usePart07b 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：连接器与 MCP 开关 · 子代理 · 专家团 — 团队会话 · 技能导入 · 粘贴图片
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import "@xterm/xterm/css/xterm.css";
import { pickEnhanceHint, shouldShowHintAfterSends, isLongPrompt, HINT_COOLDOWN_MS, HINT_AUTO_HIDE_MS } from "../../../../../lib/enhance-hints.mjs";
import { expertRoleLabel } from "../../../../../lib/expert-role-label";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";

export function usePart07b2(bag: Bag) {
  /** 清空某张专家团卡片的项目地址（回退到全局工作区） */
  function clearTeamCwd(teamId: string) {
    bag.setTeamCwdMap((current) => {
      const next = { ...current };
      delete next[teamId];
      return next;
    });
  }
bag.clearTeamCwd = clearTeamCwd as typeof bag.clearTeamCwd;

  /** 成员直达会话：点击专家/成员 chip → 立刻新建以「团队名 · 成员名」命名的空会话并跳转，
   *  不弹任务描述弹窗。用户输入的第一条消息由发送管线自动包装成 SYSTEM TASK 注入成员角色。 */
  async function startMemberDirectSession(team: ExpertTeamConfig, member: ExpertTeamMember) {
    if (!bag.customModel || !bag.selectedModel) { bag.setNotice("请先配置并启用自定义模型"); bag.setSettingsOpen(true); return; }
    const teamCwd = bag.teamCwdMap[team.teamId] ?? bag.workspace;
    if (!teamCwd) { await bag.chooseWorkspace(); return; }
    const directKey = `${team.teamId}:${member.id}`;
    bag.setExpertTeamMemberDirect(directKey);
    try {
      const result = await window.codex.startTeamMemberSession({
        teamId: team.teamId,
        memberId: member.id,
        cwd: teamCwd,
        model: bag.selectedModel?.model ?? modelName(bag.modelId),
        effort: bag.effort || undefined,
        sandbox: bag.sandbox,
        approvalPolicy: bag.approvalPolicy,
        personality: bag.selectedModel?.supportsPersonality ? bag.personality : null,
        defer: true,
      });
      bag.teamThreadMapRef.current.set(result.thread.id, team.teamId);
      if (result.role) bag.rememberExpertRole(result.thread.id, result.role);
      bag.setSettingsOpen(false);
      await bag.openThread(result.thread.id, result.thread);
      // 空线程是主进程 thread/start 直接建的，openThread 只切视图不更新左侧列表，
      // 必须显式刷新一次列表，让新会话立即出现在左侧
      void bag.refreshThreads();
      requestAnimationFrame(() => bag.composerInputRef.current?.focus());
      bag.setNotice(`已进入「${result.thread?.name ?? expertRoleLabel(member)}」会话：直接输入内容即可向该角色提问`);
    } catch (error: any) { bag.setNotice(`发起成员会话失败：${error.message}`); }
    finally { bag.setExpertTeamMemberDirect(null); }
  }
bag.startMemberDirectSession = startMemberDirectSession as typeof bag.startMemberDirectSession;

  /** 发起专家团会话：点击「发起会话」→ 立刻新建以团队名命名的空会话并跳转（不弹任务弹窗、不自动跑）；
   *  task 非空（推荐提示词按钮）时预填进输入框，用户可改可发。首条消息由发送管线包装成 SYSTEM TASK。 */
  async function startTeamSession(team: ExpertTeamConfig, task: string) {
    if (!bag.customModel || !bag.selectedModel) { bag.setNotice("请先配置并启用自定义模型"); bag.setSettingsOpen(true); return; }
    const teamCwd = bag.teamCwdMap[team.teamId] ?? bag.workspace;
    if (!teamCwd) { await bag.chooseWorkspace(); return; }
    bag.setExpertTeamRunning(team.teamId);
    try {
      const result = await window.codex.startTeamSession({
        teamId: team.teamId,
        cwd: teamCwd,
        model: bag.selectedModel?.model ?? modelName(bag.modelId),
        effort: bag.effort || undefined,
        sandbox: bag.sandbox,
        approvalPolicy: bag.approvalPolicy,
        personality: bag.selectedModel?.supportsPersonality ? bag.personality : null,
        defer: true,
      });
      bag.teamThreadMapRef.current.set(result.thread.id, team.teamId);
      bag.setThreadTeamId(team.teamId);
      bag.teamThreadConfigRef.current.set(result.thread.id, {
        teamId: team.teamId,
        cwd: teamCwd,
        model: bag.selectedModel?.model ?? modelName(bag.modelId),
        effort: bag.effort || undefined,
        sandbox: bag.sandbox,
        approvalPolicy: bag.approvalPolicy,
      });
      if (result.role) bag.rememberExpertRole(result.thread.id, result.role);
      bag.setSettingsOpen(false);
      await bag.openThread(result.thread.id, result.thread);
      // 新线程是主进程 thread/start 直接建的，openThread 只切视图不更新左侧列表，
      // 必须显式刷新一次列表，让新会话立即出现在左侧
      void bag.refreshThreads();
      const suggested = (task ?? "").trim();
      bag.setPrompt(suggested);
      requestAnimationFrame(() => bag.composerInputRef.current?.focus());
      bag.setNotice(`已进入「${result.thread?.name ?? team.displayName.zh}」会话：输入你的需求即可让团队开工`);
    } catch (error: any) { bag.setNotice(`发起专家团会话失败：${error.message}`); }
    finally { bag.setExpertTeamRunning(null); }
  }
bag.startTeamSession = startTeamSession as typeof bag.startTeamSession;

  /** 执行一次成员委托（不含对引擎的应答）：单成员调用与并行阶段共用同一段实现。
   *  并行时会有多个同时跑 —— 活动指示用计数控制，不能在 finally 里无条件清空。 */
  async function runTeamMember(toolArgs: any, leadThreadId: string): Promise<{ ok: boolean; name: string; profession: string; output: string }> {
    const parentConfig = bag.teamThreadConfigRef.current.get(leadThreadId);
    const teamId = parentConfig?.teamId || bag.teamThreadMapRef.current.get(leadThreadId) || "";
    bag.teamRunningCountRef.current += 1;
    bag.setExpertTeamMemberRunning({ teamId, memberName: String(toolArgs?.memberId ?? "") });
    try {
      const result = await window.codex.invokeTeamMember({
        teamId,
        memberId: String(toolArgs?.memberId ?? ""),
        query: String(toolArgs?.query ?? ""),
        leadThreadId,
        cwd: parentConfig?.cwd || bag.workspace || undefined,
        model: parentConfig?.model || bag.selectedModel?.model || modelName(bag.modelId),
        effort: parentConfig?.effort || bag.effort || undefined,
        sandbox: parentConfig?.sandbox || bag.sandbox,
        approvalPolicy: parentConfig?.approvalPolicy || bag.approvalPolicy,
      });
      return { ok: true, name: result.name, profession: result.profession, output: result.output };
    } catch (error: any) {
      return { ok: false, name: String(toolArgs?.memberId ?? ""), profession: "", output: `[成员调度失败]\n${error.message}` };
    } finally {
      bag.teamRunningCountRef.current -= 1;
      if (bag.teamRunningCountRef.current <= 0) { bag.teamRunningCountRef.current = 0; bag.setExpertTeamMemberRunning(null); }
    }
  }
bag.runTeamMember = runTeamMember as typeof bag.runTeamMember;

  /** 在团队会话中调度一个成员（team_member_invoke 工具回调） */
  async function invokeTeamMember(toolArgs: any, threadId: string, respondEventId: number | string) {
    const result = await bag.runTeamMember(toolArgs, threadId);
    await window.codex.respond(respondEventId, { contentItems: [{ type: "inputText", text: result.ok ? `[专家团成员 ${result.profession || result.name} 的执行结果]\n${result.output}` : result.output }], success: result.ok });
  }
bag.invokeTeamMember = invokeTeamMember as typeof bag.invokeTeamMember;

  /** 并行阶段（team_phase_invoke 工具回调）：一次提交多名成员，宿主**并发**执行后一起返回。
   *  ⛔ 这是「SOP 写着并行、实际却串行」的正解 —— 并行由宿主保证，不靠模型自觉
   *  （09-14 实测：只改提示词让它「一个回合发多个调用」无效）。 */
  async function invokeTeamPhase(tasks: any[], threadId: string, respondEventId: number | string) {
    const list = tasks.filter((task) => task && String(task.memberId ?? "").trim());
    if (!list.length) {
      await window.codex.respond(respondEventId, { contentItems: [{ type: "inputText", text: "team_phase_invoke 需要至少一个成员任务（tasks 为空）" }], success: false });
      return;
    }
    const results = await Promise.all(list.map((task) => bag.runTeamMember(task, threadId)));
    const text = results.map((entry) => `[专家团成员 ${entry.profession || entry.name} 的执行结果]\n${entry.output}`).join("\n\n---\n\n");
    await window.codex.respond(respondEventId, { contentItems: [{ type: "inputText", text }], success: results.some((entry) => entry.ok) });
  }
bag.invokeTeamPhase = invokeTeamPhase as typeof bag.invokeTeamPhase;

  async function importSkill() {
    try {
      const result = await window.codex.importSkill();
      if (!result) return;
      const next = await window.codex.listLocalSkills();
      bag.setLocalSkills(next);
      await bag.refreshSettingsResources();
      bag.setNotice(`技能已导入：${result.name}`);
    } catch (error: any) { bag.setNotice(`导入技能失败：${error.message}`); }
  }
bag.importSkill = importSkill as typeof bag.importSkill;

  /** 卸载技能：与安装对称，先用进度弹窗接手（校验→删除→清理登记→重启引擎→确认移除），
   *  主进程逐步回推事件推进进度；结束时报「引擎是否已确认移除」，不再是一闪而过的 toast。 */
  async function removeLocalSkill(entry: { folder?: string; name: string; description?: string }) {
    const folder = entry.folder ?? entry.name;
    bag.setSkillRemove({ folder, name: entry.name, description: entry.description ?? "", current: 0 });
    try {
      const result = await window.codex.removeLocalSkill({ folder, name: entry.name });
      bag.setLocalSkills(await window.codex.listLocalSkills());
      await bag.refreshSettingsResources();
      bag.setSkillRemove((current) => current && current.folder === folder ? { ...current, current: 6, engineRemoved: result?.engineRemoved, engineCheckMessage: result?.engineCheckMessage } : current);
      bag.setNotice(result?.engineRemoved === false ? `技能已删除：${entry.name}（等待引擎下一轮扫描确认）` : `技能已卸载：${entry.name}`);
    } catch (error: any) {
      bag.setSkillRemove((current) => current && current.folder === folder ? { ...current, failed: error.message } : null);
      bag.setNotice(`卸载技能失败：${error.message}`);
      void window.codex.listLocalSkills().then(bag.setLocalSkills).catch(() => undefined);
    }
  }
bag.removeLocalSkill = removeLocalSkill as typeof bag.removeLocalSkill;

  /** 粘贴图片：主进程读剪贴板位图落盘（截图/网页复制图都走这条）。
   *  fallbackPath = 粘贴事件里的纯文本，用于「资源管理器复制图片文件」这类
   *  剪贴板无位图、只有路径文本的来源；仅接受单行、无协议、扩展名像图片的路径。 */
  async function pasteImage(fallbackPath = "") {
    const value = await window.codex.readClipboardImage();
    if (value) { bag.insertComposerImages([value]); return; }
    const candidate = fallbackPath.trim();
    if (candidate && !candidate.includes("\n") && !candidate.includes("://") && /\.(png|jpe?g|gif|webp|bmp)$/i.test(candidate)) {
      bag.insertComposerImages([candidate]);
      return;
    }
    bag.setNotice("剪贴板中没有图片");
  }
bag.pasteImage = pasteImage as typeof bag.pasteImage;

  /** 触发提示词增强：原文备份 → 调主进程 LLM 润色 → 替换输入框文本。
   *  增强后按钮进入撤销模式（再点还原原文）；用户改动文本即清除备份（WorkBuddy 同款）。 */
/** 展示增强提示气泡（3 秒后自动消失；09-20 用户要求「文字时间短一点」，原 6 秒 → `HINT_AUTO_HIDE_MS`）。 */
function showEnhanceHint() {
  bag.setEnhanceHint(pickEnhanceHint(bag.lastEnhanceHintRef.current));
  bag.enhanceHintFiredAtRef.current = Date.now();
  if (bag.enhanceHintTimerRef.current != null) window.clearTimeout(bag.enhanceHintTimerRef.current);
    bag.enhanceHintTimerRef.current = window.setTimeout(() => {
      bag.setEnhanceHint(null);
      bag.enhanceHintTimerRef.current = null;
    }, HINT_AUTO_HIDE_MS);
  }
bag.showEnhanceHint = showEnhanceHint as typeof bag.showEnhanceHint;

  function dismissEnhanceHint() {
    if (bag.enhanceHintTimerRef.current != null) { window.clearTimeout(bag.enhanceHintTimerRef.current); bag.enhanceHintTimerRef.current = null; }
    bag.setEnhanceHint(null);
  }
bag.dismissEnhanceHint = dismissEnhanceHint as typeof bag.dismissEnhanceHint;
  return { clearTeamCwd, startMemberDirectSession, startTeamSession, runTeamMember, invokeTeamMember, invokeTeamPhase, importSkill, removeLocalSkill, pasteImage, showEnhanceHint, dismissEnhanceHint };
}
