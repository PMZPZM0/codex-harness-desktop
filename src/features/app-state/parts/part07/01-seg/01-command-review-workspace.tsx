/**
 * usePart07a1 —— usePart07a 按序切分出的第 1 段（纯搬迁、零改写）。
 * 域：斜杠命令/评审/工作区 — 图片与文件选择 · 市场技能与插件 · 连接器与 MCP
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import "@xterm/xterm/css/xterm.css";
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "../../../../../lib/user-refs";
import { basename } from "../../../../../lib/basename";
import { copyTextToClipboard } from "../../../../../lib/clipboard";
import { effortLabels } from "../../../../../lib/effort-labels";
import { ThreadItem } from "../../../../../lib/thread-item";
import { itemText } from "../../../../../lib/item-text";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";

export function usePart07a1(bag: Bag) {
  async function runSlashCommand(value: string) {
    const [rawName, ...rest] = value.slice(1).trim().split(/\s+/);
    const name = rawName.toLowerCase();
    const argument = rest.join(" ").trim();
    if (!slashCommands.some(([command]) => command === name)) {
      // 自定义命令：命中 $CODEX_HOME/commands 或 .codex/commands 下的 .md 模板，
      // 展开参数/文件引用后作为普通消息发送（复刻 WorkBuddy 自定义命令语义）。
      try {
        const customList = await window.codex.listCommands({ cwd: bag.workspace ?? undefined });
        const custom = customList.find((entry) => entry.name.toLowerCase() === name);
        if (!custom) return false;
        if (custom.argumentHint && !argument) {
          bag.setPrompt(`/${name} `);
          bag.showToast("命令需要参数", `/${name} ${custom.argumentHint}${custom.description ? ` — ${custom.description}` : ""}`);
          return true;
        }
        if (bag.sending) { bag.showToast("任务仍在运行", `请先使用 /stop，再执行 /${name}`); return true; }
        const { text } = await window.codex.expandCommand({ filePath: custom.filePath, argument, cwd: bag.workspace ?? undefined });
        bag.pendingCommandTextRef.current = text;
        bag.setPrompt("");
        await bag.send();
        return true;
      } catch (error: any) {
        bag.showToast(`/${name} 执行失败`, error.message);
        return true;
      }
    }
    bag.setPrompt("");
    try {
      if (name === "model" || name === "permissions") bag.setSettingsOpen(true);
      else if (name === "new") bag.startNewThread();
      else if (name === "resume") { bag.setMobileNav(true); bag.showToast("历史任务", "从左侧任务列表选择要恢复的会话"); }
      else if (name === "cd") await bag.chooseWorkspace();
      else if (name === "pwd") bag.setInfoModal({ title: "当前工作目录", body: bag.workspace || "尚未选择工作区" });
      else if (name === "diff") { bag.setRightOpen(true); bag.showToast("文件改动", "已在右侧面板展示本轮 diff"); }
      else if (name === "status") bag.setInfoModal({ title: "任务状态", body: `模型：${bag.customModel?.model ?? "未配置"}\n思考：${effortLabels[bag.effort] ?? bag.effort}\n风格：${bag.personality === "pragmatic" ? "务实" : bag.personality === "friendly" ? "友好" : "默认"}\n线程：${bag.thread?.status?.type ?? "未开始"}\n回合：${bag.thread?.turns.at(-1)?.status ?? "无"}\n工作区：${bag.workspace || "未选择"}` });
      else if (name === "help") bag.setInfoModal({ title: "可用命令", body: builtinCommandCatalog.map((cmd) => `/${cmd.name}${cmd.hint ? " " + cmd.hint : ""} — ${cmd.description}`).join("\n") });
      else if (name === "context") bag.setInfoModal({ title: "上下文占用", body: bag.contextUsageText() });
      else if (name === "doctor") await bag.runEnvironmentCheck();
      else if (name === "clear") {
        // ⛔ 必须确认（09-13 审计）：`clearCurrentConversation` 是 `thread/delete` + 从侧栏移除
        // = **永久删除**，而命令目录里把它描述成「清空上下文…旧会话保留在历史里」，
        // 文案与行为相反 → 用户按文案理解就会不可逆地删掉整个会话（含工具记录）。
        // 同族的 /delete 一直有确认，这条漏了。
        const confirmed = await bag.openAppConfirm(
          "永久删除当前会话？",
          `「${cleanThreadDisplayTitle(bag.thread?.name, { preview: bag.thread?.preview }) || "当前会话"}」的消息与工具记录会被删除，且无法恢复。\n（只是想清空上下文继续聊，请用 /compact 或直接新建会话。）`,
          "永久删除",
        );
        if (confirmed) await bag.clearCurrentConversation();
      }
      else if (name === "copy") { const last = bag.thread?.turns.flatMap((turn) => turn.items).filter((item) => item.type === "agentMessage").at(-1); await bag.copyMessage(itemText(last ?? ({} as ThreadItem))); }
      else if (name === "memory") { bag.setSettingsOpen(true); bag.setSettingsPage("memory"); }
      else if (name === "effort") {
        if (!argument) bag.showToast("用法", "/effort 极简|低|中|高|最高|极高|max");
        else {
          const alias: Record<string, string> = { 极简: "minimal", 低: "low", 中: "medium", 高: "high", 最高: "ultra", 极高: "xhigh", 极限: "ultra", 深度: "xhigh", 极少: "minimal", 轻量: "low", 均衡: "medium", 标准: "high", max: "xhigh", minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", ultra: "ultra" };
          const target = alias[argument];
          if (!target) bag.showToast("不支持的思考强度", "可选：极简 / 低 / 中 / 高 / 最高 / 极高");
          else { bag.changeEffort(target); bag.showToast("思考强度已更新", effortLabels[target] ?? target); }
        }
      } else if (name === "personality") {
        const alias: Record<string, string> = { 务实: "pragmatic", 友好: "friendly", 默认: "none" };
        const target = alias[argument];
        if (!target) bag.showToast("用法", "/personality 务实|友好|默认");
        else { bag.changePersonality(target); bag.showToast("回复风格已更新", argument); }
      } else if (name === "sandbox") {
        const alias: Record<string, string> = { 只读: "read-only", 工作区可写: "workspace-write", 完全访问: "danger-full-access", "read-only": "read-only", "workspace-write": "workspace-write", "danger-full-access": "danger-full-access" };
        const target = alias[argument];
        if (!target) bag.showToast("用法", "/sandbox 只读|工作区可写|完全访问");
        else { bag.changeSandbox(target); bag.showToast("沙箱已切换", argument); }
      } else if (name === "approval") {
        const alias: Record<string, string> = { 按需: "on-request", 从不: "never", "on-request": "on-request", never: "never" };
        const target = alias[argument];
        if (!target) bag.showToast("用法", "/approval 按需|从不");
        else { bag.changeApproval(target); bag.showToast("审批策略已更新", argument); }
      } else if (name === "stop") await bag.interrupt();
      else {
        if (!bag.thread) { bag.showToast("无法执行", `/${name} 需要先开始一个任务`); return true; }
        if (name === "archive") await bag.archiveThread(bag.thread.id);
        else if (name === "delete") {
          if (await bag.openAppConfirm("清空当前对话", "当前会话及其中的消息将被永久删除，此操作无法撤销。", "永久删除")) {
            await window.codex.request("thread/delete", { threadId: bag.thread.id });
            bag.setThreads((current) => current.filter((entry) => entry.id !== bag.thread!.id));
            bag.setThread(null);
          }
        } else if (name === "rename") {
          if (!argument) bag.showToast("用法", "/rename 新名称");
          else await bag.renameThread(bag.thread.id, argument);
        } else if (name === "fork") {
          const result = await window.codex.request("thread/fork", { threadId: bag.thread.id, excludeTurns: false });
          bag.setThread(result.thread);
          bag.setModelId(`custom:${bag.customModel?.provider}:${bag.customModel?.model}`);
          await bag.refreshThreads();
          bag.showToast("任务已分叉", "接下来的对话会写入新的任务分支");
        } else if (name === "compact") {
          bag.compactPendingRef.current.add(bag.thread.id);
          bag.setCompactEventState("running");
          try {
            await window.codex.request("thread/compact/start", { threadId: bag.thread.id });
          } catch (error: any) {
            bag.compactPendingRef.current.delete(bag.thread.id);
            bag.setCompactEventState("error", error.message);
            throw error;
          }
        } else if (name === "review") {
          const target = argument ? { type: "custom", instructions: argument } : { type: "uncommittedChanges" };
          const result = await window.codex.request("review/start", { threadId: bag.thread.id, target, delivery: "inline" });
          bag.setActiveTurnId(result.turn.id);
          bag.markThreadRunning(bag.thread.id, result.turn.id);
        } else if (name === "goal") {
          // /goal 目标模式：引擎原生 thread goal——目标持续存在跨回合，回合结束后引擎
          // 自动 continuation 续跑，模型用 update_goal 工具判定 complete/blocked 后停。
          if (argument === "clear" || argument === "停止" || argument === "stop") {
            await window.codex.request("thread/goal/clear", { threadId: bag.thread.id });
            bag.setGoalText("");
            bag.setGoalStatus(null);
            bag.showToast("目标模式已停止", "已清除长期目标，自动推进结束");
          } else if (argument) {
            await window.codex.request("thread/goal/set", { threadId: bag.thread.id, objective: argument });
            bag.showToast("目标模式已启动", "将自动持续推进直到目标达成；/goal clear 可随时停止");
          } else {
            const result = await window.codex.request("thread/goal/get", { threadId: bag.thread.id });
            const goal = result.goal;
            const statusLabel: Record<string, string> = { active: "进行中", paused: "已暂停", blocked: "受阻", usageLimited: "用量受限", budgetLimited: "预算受限", complete: "已完成" };
            bag.setInfoModal({ title: "目标模式", body: goal?.objective ? `状态：${statusLabel[goal.status ?? ""] ?? goal.status ?? "进行中"}\n目标：${goal.objective}${goal.tokensUsed != null ? `\n已消耗：${goal.tokensUsed} tokens` : ""}` : "尚未设置目标；用法 /goal <目标描述>" });
          }
        } else if (name === "plan") {
          // /plan 计划模式：本轮以引擎原生 plan 协作模式运行（模型只调研+出方案，不执行改动），
          // 方案输出后弹「开始执行」确认条，确认后按方案正常执行。
          if (!argument) bag.showToast("用法", "/plan <任务描述> —— 先出方案，确认后执行");
          else {
            bag.planOnceRef.current = true;
            bag.setPlanArmed(true);
            bag.pendingCommandTextRef.current = argument;
            bag.showToast("计划模式已启动", "本轮只调研并输出方案，确认后才开始执行");
            await bag.send();
          }
        } else if (name === "undo") {
          const result = await window.codex.request("thread/rollback", { threadId: bag.thread.id, numTurns: 1 });
          bag.threadRef.current = result.thread;
          bag.setThread(result.thread);
          bag.showToast("已撤销上一轮", "仅回退对话历史，不会撤销工作区文件改动");
        } else if (name === "queue") {
          const result = await window.codex.request("thread/queue/list", { threadId: bag.thread.id, limit: 100 });
          bag.setInfoModal({ title: "消息队列", body: result.data?.length ? result.data.map((entry: any, index: number) => `${index + 1}. ${entry.input?.find((part: any) => part.type === "text")?.text ?? "附件消息"}`).join("\n") : "队列为空" });
        } else if (name === "skills") {
          const result = await window.codex.request("skills/list", { cwds: bag.workspace ? [bag.workspace] : [], forceReload: false });
          const skills = (result.data ?? []).flatMap((entry: any) => entry.skills ?? []);
          // 描述多为英文：统一走中文注释（输入框「#」面板同款口径），每个技能都有一句中文说明。
          const seen = new Set<string>();
          const rows: string[] = [];
          for (const skill of skills) {
            const key = normSkillName(skill.name);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            rows.push(`${skill.enabled ? "●" : "○"} ${shortSkillName(skill.name)} —— ${skillZhNote(skill)}`);
          }
          bag.setInfoModal({ title: "可用技能", body: rows.length ? `${rows.join("\n")}\n\n提示：在输入框输入 # 可快速引用技能` : "没有发现可用 Skill" });
        } else if (name === "mcp") {
          const result = await window.codex.request("mcpServerStatus/list", { detail: "toolsAndAuthOnly", threadId: bag.thread.id });
          bag.setInfoModal({ title: "MCP 服务", body: result.data?.length ? result.data.map((server: any) => `${server.name} - ${server.runtimeStatus?.type ?? server.runtimeStatus ?? server.authStatus}`).join("\n") : "没有配置 MCP 服务" });
        } else if (name === "plugins") {
          const result = await window.codex.request("plugin/list", { cwds: bag.workspace ? [bag.workspace] : [], forceRefetch: false });
          const plugins = (result.marketplaces ?? []).flatMap((marketplace: any) => marketplace.plugins ?? []);
          bag.setInfoModal({ title: "插件", body: plugins.length ? plugins.map((plugin: any) => `${plugin.installed ? "●" : "○"} ${plugin.name}`).join("\n") : "没有发现插件" });
        } else if (name === "apps") {
          const result = await window.codex.request("app/list", { limit: 100, threadId: bag.thread.id, forceRefetch: false });
          bag.setInfoModal({ title: "Apps", body: result.data?.length ? result.data.map((app: any) => `${app.isEnabled ? "●" : "○"} ${app.name}`).join("\n") : "没有可用 App" });
        }
      }
    } catch (error: any) {
      bag.showToast(`/${name} 执行失败`, error.message);
    }
    return true;
  }
bag.runSlashCommand = runSlashCommand as typeof bag.runSlashCommand;



    function startReview(instructions: string) {
    if (!bag.thread) { bag.setNotice("先开始一个任务再运行审查"); return; }
    bag.setReviewBusy(true);
    bag.setReviewReport("");
    void window.codex.request("review/start", {
      threadId: bag.thread.id,
      target: instructions.trim() ? { type: "custom", instructions: instructions.trim() } : { type: "uncommittedChanges" },
      delivery: "inline",
    }).then((result: any) => {
      bag.reviewTurnRef.current = result?.turn?.id ?? null;
      if (!bag.reviewTurnRef.current) { bag.setReviewBusy(false); bag.setNotice("审查未返回回合"); }
    }).catch((error: any) => {
      bag.setReviewBusy(false);
      bag.setNotice(`审查启动失败：${error.message}`);
    });
  }
bag.startReview = startReview as typeof bag.startReview;



  async function chooseWorkspace() {
    const value = await window.codex.chooseDirectory();
    if (!value) return;
    bag.setWorkspace(value);
    bag.workspaceRef.current = value; // ref 同步：send 弹窗选完要立刻读到（state 是异步的）
    localStorage.setItem("workspace", value);
    const target = bag.thread;
    if (!target) return;
    // ⛔ 09-19 用户实测：「在已创建会话上修改项目地址 —— 改了只是对话框上面显示改了，左侧栏没有变化，
    //   新增的项目地址也不出现，这个切换项目地址功能这样看就是假的」。
    //   原因：这里原来只改了本地 state + localStorage + 发给引擎，**没动列表里那条记录**；
    //   而侧栏项目分组（projectGroups）是按 `threads[].cwd` 派的 ⇒ 会话仍挂在旧项目下；
    //   且引擎 `thread/list` 回包的 cwd 是创建时那个（settings/update 只改运行时目录），
    //   ⇒ 不改本地覆盖的话下一次刷新就把改动顶回去（所以「假的」）。
    //   现在四件事一起做：① 引擎设置（运行时生效）② 列表条目 + 打开的 thread 与缓存（侧栏立刻搬家）
    //   ③ 本地覆盖落盘（刷新/重启后仍然认）④ 展开新项目（用户改完就该看见它）。
    const settings = bag.sandbox === "workspace-write" ? { cwd: value, sandboxPolicy: sandboxPolicy(bag.sandbox, value) } : { cwd: value };
    await bag.updateThreadSettings(settings);
    bag.rememberThreadCwd(target.id, value);
    bag.setThreads((current) => current.map((entry) => entry.id === target.id ? { ...entry, cwd: value } : entry));
    const cached = bag.threadCacheRef.current.get(target.id);
    if (cached) bag.threadCacheRef.current.set(target.id, { ...cached, cwd: value });
    if (bag.threadRef.current?.id === target.id) {
      const next = { ...bag.threadRef.current, cwd: value };
      bag.threadRef.current = next;
      bag.setThread(next);
    }
    bag.setExpandedProjects((prev) => {
      const next = new Set(prev);
      next.add(value);
      try { localStorage.setItem("sidebar-projects-expanded-v1", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
    bag.showToast("项目地址已切换", `该会话现在属于 ${basename(value)}`);
    void bag.refreshThreads().catch(() => undefined);
  }
bag.chooseWorkspace = chooseWorkspace as typeof bag.chooseWorkspace;

  /** 环境自查（09-23，对标 WorkBuddy 5.4.0「客户端自检工具」/ 5.3.11「出错时一键诊断」）。
   *  能力早就在主进程（`app:doctor`），但**渲染层从来没接**——`/doctor` 只是一张注释里的空头支票
   *  （命令目录里没有它、分发里也没有分支）。用户侧的表现是"出错了只能复述给我听"，而不是"点一下自查"。
   *  结论同时**落到信息弹窗**（可看）并**复制到剪贴板**（可粘贴到反馈里）。 */
  async function runEnvironmentCheck() {
    bag.showToast("正在自查", "读取引擎二进制、版本、工作区与本地环境…");
    try {
      const report = await window.codex.doctor(bag.workspace || undefined);
      const checks = Array.isArray(report?.checks) ? report.checks : [];
      const failed = checks.filter((item) => !item.ok);
      const body = [
        `环境自查 · ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
        `结论：${failed.length === 0 ? "全部通过" : `${failed.length} 项异常`}（共 ${checks.length} 项）`,
        "",
        ...checks.map((item) => `${item.ok ? "✅" : "❌"} ${item.label}：${item.detail}`),
      ].join("\n");
      bag.setInfoModal({ title: "环境自查", body });
      await copyTextToClipboard(body);
      if (failed.length) bag.showToast("自查发现异常", `${failed.map((item) => item.label).join("、")}（结论已复制）`);
    } catch (error: any) {
      bag.showToast("自查失败", String(error?.message ?? error));
    }
  }
bag.runEnvironmentCheck = runEnvironmentCheck as typeof bag.runEnvironmentCheck;
  return { runSlashCommand, startReview, chooseWorkspace, runEnvironmentCheck };
}
