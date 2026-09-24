/**
 * usePart06b2 —— usePart06b 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：回合运行态与运行时同步 · 模型选择与线程设置权限
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import "@xterm/xterm/css/xterm.css";
import { DEFAULT_EFFORT, pickDefaultEffort, normalizeEffort, ALL_EFFORTS, declaredModelEfforts } from "../../../../../lib/effort";
import { ALIGN_RESULT, CONTINUITY_TEXT, HARNESS_PROVIDER_ID, shouldAlignProvider } from "../../../../../lib/provider-continuity.mjs";
import { classifyUnit, buildSegments, buildOrderedToolRuns, foldItemStatus, computeFoldSummary, topToolGroup, isTurnRunning, normalizeLoadedThread, type FoldUnit } from "../../../../../lib/turn-fold";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";

export function usePart06b2(bag: Bag) {
  async function chooseModel(value: string) {
    const prevLabel = modelName(bag.modelId) || bag.modelId;
    // value 形如 `custom:<provider>:<model>`
    const match = value.match(/^custom:([^:]+):(.+)$/);
    const provider = match?.[1];
    const model = match?.[2] ?? value;
    const next = bag.allModels.find((entry) => entry.id === value || entry.model === value);
    const nextLabel = next?.model ?? modelName(value);
    const currentThreadId = bag.threadRef.current?.id;
    const saveSelection = (nextId: string) => {
      bag.setModelId(nextId);
      // 作用域：**有会话就只记到这个会话名下**（其它会话不受影响）；没有会话时选的才算
      // 「新会话默认」（src/lib/model-scope.mjs）。
      if (currentThreadId) saveThreadModel(currentThreadId, nextId);
      else bag.applyGlobalModelChoice(nextId);
    };
    // 跨供应商切换 = 切换全局 API Key，必须重启引擎生效。用户要求「切换必须重启应用」：
    // 弹窗确认后先落盘配置（apply:false 不重启引擎），再整体重启应用——启动时引擎按新
    // 供应商的 Key 全新注入，状态彻底归位；旧会话下次打开时由发送前迁移自动跟随。
    if (provider && bag.customModel && provider !== bag.customModel.provider) {
      if (!(await bag.openAppConfirm("切换供应商", `将切换到 ${nextLabel || model}，应用将自动重启使配置完全生效。\n正在运行的任务会被中断，会话历史完整保留。\n是否继续？`, "切换并重启应用"))) return;
      try {
        await window.codex.setProviderModel({ provider, model, apply: false }); // 只落盘
        const selectedId = `custom:${provider}:${model}`;
        saveSelection(selectedId);
        // 跨供应商切换是明确的全局模型变更：全局默认 + **当前会话**一起换（其它会话不动）
        bag.applyGlobalModelChoice(selectedId);
        bag.showToast("已切换", "应用即将重启以完全生效……");
        setTimeout(() => { void window.codex.relaunchApp(); }, 800);
        return;
      } catch (error: any) {
        bag.setNotice(`切换供应商失败：${error.message}`);
        return;
      }
    }
    // 用户主动切模型时给一条会话内提醒（与引擎 sideband 的模型切换事件互为补充）
    if (nextLabel && prevLabel && nextLabel !== prevLabel) bag.showToast("模型已切换", `${prevLabel} → ${nextLabel}`);
    // 切模型的 effort 选择：该模型记过档位用之（本地 map 或档案 models[].effort——后者
    // 跨窗口/重装都在，「跟着模型保存」的读取端）；否则当前会话已有档位保持不变（会话内
    // 不突袭改档）；都没有才落到模型默认档
    const threadEffort = currentThreadId ? loadThreadEffort(currentThreadId) : "";
    const archiveEffort = (bag.customModel?.models ?? []).find((m) => m.id === next?.model)?.effort
      ?? (next?.model === bag.customModel?.model ? bag.customModel?.effort ?? "" : "");
    const nextEffort = bag.savedEffortFor(next?.model) || archiveEffort || threadEffort || pickDefaultEffort(next?.supportedReasoningEfforts, next?.defaultReasoningEffort);
    bag.setEffort(nextEffort);
    if (nextEffort) {
      // ⛔ 多会话/多窗口作用域（09-13）：有会话只落会话级（thread-effort-<id>），
      // 不写 default-effort 全局默认——A 会话切模型连带切档位，会把 B 会话的
      // 重启兜底/新会话默认一起改掉。无会话时选的才是全局默认。
      if (currentThreadId) saveThreadEffort(currentThreadId, nextEffort);
      else localStorage.setItem("default-effort", nextEffort);
    }
    saveSelection(value);

    // 同供应商模型已在 catalog 中，直接更新当前会话即可，不重启引擎。
    if (provider && bag.customModel && provider === bag.customModel.provider) {
      try {
        await bag.updateThreadSettings({ model, model_provider: provider, effort: nextEffort || null });
        // ⛔ 多窗口模型作用域（09-13）：这里**不再**调 setProviderModel({apply:true}) 写全局
        // —— 它会改写 custom-model.json 顶层 model + config.toml 顶层 `model = "..."`，
        // 那是全应用共享的一份磁盘配置。单窗口时代「当前会话=全局」没毛病；两个独立会话
        // 窗口后互相污染：A 窗口切模型 → B 窗口会话自查「我是谁」读 config 顶层 → 报成
        // A 的模型（用户实测 glm/deepseek 错位）。会话级模型靠 updateThreadSettings +
        // 每轮 turn/start 的 model 参数（权威判据 = rollout turn_context.model），全局
        // 落盘只在「无会话选默认」/「跨供应商切换」两条路径发生。
        if (!currentThreadId) {
          // 无会话时选的才是「新会话默认」：写全局档案（apply:false 只落盘不动引擎）
          void window.codex.setProviderModel({ provider, model, apply: false }).catch(() => {});
        }
        bag.setNotice(`${bag.threadRef.current ? "当前会话" : "新会话默认"}已选择：${bag.customModel.name} · ${model}`);
        return;
      } catch (error: any) {
        bag.setNotice(error.message);
        return;
      }
    }
    // 无 provider 前缀（内置模型）：只更新线程设置
    void bag.updateThreadSettings({ model: model ?? value, effort: nextEffort || null });
  }
bag.chooseModel = chooseModel as typeof bag.chooseModel;



  /** 会话跨供应商迁移：引擎线程绑定创建时的 provider，settings/update 换 provider 会被拒。
   *  唯一官方通道 = thread/resume { modelProvider, config, model }（schema 实证 resume 接受
   *  这三个覆盖参数）——resume 后会话即绑定新供应商，历史完整保留，原会话数据不丢。 */
  async function migrateThreadToProvider(threadId: string, target: { provider: string; model: string; name: string; baseUrl: string; wireApi?: string }): Promise<{ ok: boolean; error?: string }> {
    try {
      const officialTarget = target.provider === "openai-official";
      const resumeParams: Record<string, unknown> = {
        threadId,
        excludeTurns: true,
        model: target.model,
        // 实证（rollout 07:19:54）：引擎重启后 resume 若不带 sandbox，线程权限被重置成
        // workspace-write+restricted——完全访问静默失效。resume 接受 sandbox 字符串
        // （schema 实证），这里带上当前用户偏好，迁移同时把权限一并钉住。
        sandbox: bag.sandbox,
        approvalPolicy: bag.approvalPolicy,
        // 官方订阅走引擎内置 openai 通道：不传 modelProvider/config（实证：传了即触发
        // CODEX_HARNESS_API_KEY 校验导致流断）；其他供应商内联完整定义
        ...(officialTarget ? {} : {
          // 迁移后也绑**统一内置 id**：这个会话从此永久对齐（下次不用再迁）。
          modelProvider: HARNESS_PROVIDER_ID,
          config: {
            model_provider: HARNESS_PROVIDER_ID,
            model_providers: {
              [HARNESS_PROVIDER_ID]: {
                name: target.name,
                base_url: target.baseUrl,
                env_key: "CODEX_HARNESS_API_KEY",
                // ⛔ 恒 responses：引擎对 wire_api = "chat" 是整份配置拒载（09-16 探针实证），
                // 透传 chat 会让这个会话（及后续所有请求）直接打不开。
                wire_api: "responses",
                requires_openai_auth: false,
              },
            },
          },
        }),
      };
      await window.codex.request("thread/resume", resumeParams);
      await bag.updateThreadSettings({ model: target.model, ...(officialTarget ? {} : { model_provider: HARNESS_PROVIDER_ID }), effort: null });
      // 迁移成功：更新会话绑定供应商登记表（发送前检测依赖此表）
      bag.threadProviderRef.current.set(threadId, HARNESS_PROVIDER_ID);
      return { ok: true };
    } catch (error: any) {
      // ⛔ mac 上用户报「换供应商自动新建会话、旧会话死掉」＝原地迁移失败后每次都走 fork
      // 接力。旧实现把引擎的真实报错吞成 return false，根本没法定位——这里把原因带上。
      const message = String(error?.message ?? error ?? "resume 失败");
      console.warn("[align] thread/resume 迁移失败", threadId, target.provider, message);
      return { ok: false, error: message };
    }
  }
bag.migrateThreadToProvider = migrateThreadToProvider as typeof bag.migrateThreadToProvider;



  /** 会话「自动接力」到当前激活供应商（09-14 用户定稿：切换供应商后旧会话要能直接继续用）。
   *  统一入口——打开会话 / 发送前 / 401 兜底 / 切换供应商 全部走这里，行为与文案一致：
   *   ① 原地迁移优先：thread/resume 重绑定（threadId 不变 → 历史、消息、侧栏位置全不动，用户无感）
   *   ② 原地失败（极老会话/无 rollout）→ 接力：thread/fork 建带完整历史的新会话，旧会话自动归档
   *  ⛔ 旧会话不可删：接力也保留历史（fork 自带），归档只是收起来，不丢数据。
   *  返回 "same"（无需迁移）/ "migrated"（原地）/ "relayed"（接力）/ "failed"（都失败）。 */
  async function alignThreadToProvider(
    threadId: string,
    target: { provider: string; model: string; name: string; baseUrl: string; wireApi?: string },
    opts?: { reason?: "open" | "send" | "error" | "switch"; silent?: boolean },
  ): Promise<"same" | "migrated" | "relayed" | "failed"> {
    const bound = bag.threadProviderRef.current.get(threadId);
    // 判定收在纯模块里（可离线断言）：绑定未知（本次启动未 resume 过）不迁——不猜。
    if (!shouldAlignProvider(bound, target.provider)) return ALIGN_RESULT.same;
    const label = `${target.name} · ${target.model}`;
    if (!opts?.silent) bag.showToast("正在自动接力", CONTINUITY_TEXT.aligning(label));
    // ① 原地迁移（首选）：threadId 不变，历史与侧栏位置全不动，用户完全感知不到
    const migrated = await bag.migrateThreadToProvider(threadId, target);
    if (migrated.ok) {
      saveThreadModel(threadId, `custom:${target.provider}:${target.model}`);
      if (!opts?.silent) bag.showToast("已自动接力", CONTINUITY_TEXT.migrated(label));
      return ALIGN_RESULT.migrated;
    }
    // ② 原地失败 → fork 接力：新会话带完整历史，旧会话自动归档（侧栏不留两坨）
    try {
      const forked = await window.codex.request("thread/fork", { threadId, excludeTurns: false });
      const next = (forked as any)?.thread;
      if (!next?.id) throw new Error("引擎未返回新分支");
      const relayed = await bag.migrateThreadToProvider(next.id, target);
      if (!relayed.ok) throw new Error(relayed.error || "接力会话绑定失败");
      saveThreadModel(next.id, `custom:${target.provider}:${target.model}`);
      bag.threadProviderRef.current.set(next.id, HARNESS_PROVIDER_ID);
      await bag.refreshThreads();
      await bag.openThread(next.id, next);
        // 旧会话自动清除（09-15 用户定稿：接力成功后**只保留新的**）：fork 已带完整历史，
        // 旧会话没有保留价值——只归档还会在归档管理留一坨，用户明确要的是「旧的不在了」。
        // 若旧会话是团队主会话，级联规则会一并清掉成员会话。
        if (bag.threadRef.current?.id !== threadId) {
          // ⛔ 接力 = 换了会话 id：源会话的全部衍生状态必须彻底重置（用户 09-19：「复制会话 ID
          //   接力的也必须从根源上完全重置」），否则它的退避定时器到点会对着旧 id 重发。
          bag.resetSessionRetryState(threadId);
        await bag.cascadeTeamCluster(threadId, "delete");
        try { await window.codex.request("thread/delete", { threadId }); } catch { /* 已不存在则跳过 */ }
        bag.threadCacheRef.current.delete(threadId);
        bag.setThreads((current) => current.filter((entry) => entry.id !== threadId));
        bag.markThreadStopped(threadId);
      }
      bag.showToast("已自动接力", CONTINUITY_TEXT.relayed(label));
      return ALIGN_RESULT.relayed;
    } catch (error: any) {
      // ⛔ 失败必带原因（09-16）：裸文案用户只能截图没法报障，带上引擎真实报错才可定位
      const detail = error?.message ? `（${String(error.message).slice(0, 160)}）` : "";
      bag.showToast("自动接力失败", CONTINUITY_TEXT.failed(label) + detail);
      return ALIGN_RESULT.failed;
    }
  }
bag.alignThreadToProvider = alignThreadToProvider as typeof bag.alignThreadToProvider;


  /** 供应商切换「重启生效」：重启引擎使新供应商配置生效，成功后迁移当前会话并刷新 UI 状态。
   *  手动点击 banner 时读 state；引擎空闲自动生效时由 chooseModel 直接传入 pending 对象。 */
  async function applyPendingRestart(pendingOverride?: { provider: string; model: string; label: string; prevProvider: string; prevModel: string } | null) {
    const pending = pendingOverride ?? bag.pendingRestartRef.current;
    if (!pending) return;
    try {
      const updated = await window.codex.applyCustomModel();
      bag.setCustomModel(updated);
      bag.setModelId(`custom:${updated.provider}:${updated.model}`);
      bag.applyGlobalModelChoice(`custom:${updated.provider}:${updated.model}`);
      // 会话跨供应商迁移 = 自动接力（统一入口 alignThreadToProvider：原地迁移优先——threadId
      // 不变、历史与侧栏位置全不动；原地失败则 fork 接力并自动归档旧会话）。
      if (bag.threadRef.current?.id) {
        await bag.alignThreadToProvider(bag.threadRef.current.id, {
          provider: updated.provider, model: updated.model, name: updated.name, baseUrl: updated.baseUrl, wireApi: updated.wireApi,
        }, { reason: "switch" });
      } else {
        await bag.updateThreadSettings({ model: updated.model, ...(updated.provider === "openai-official" ? {} : { model_provider: updated.provider }), effort: null });
      }
      bag.setPendingRestart(null);
      bag.setNotice(`已切换到 ${updated.name} · ${updated.model}`);
    } catch (error: any) {
      // 失败时挂上 banner 供手动重试（自动模式失败也可见，避免静默失败）
      if (pendingOverride && !bag.pendingRestartRef.current) bag.setPendingRestart(pendingOverride);
      bag.setNotice(`重启生效失败：${error.message}`);
    }
  }
bag.applyPendingRestart = applyPendingRestart as typeof bag.applyPendingRestart;



  /** 撤销待重启的供应商切换：把激活配置恢复为原供应商（只改配置不重启，原会话不受影响） */
  async function cancelPendingRestart() {
    const pending = bag.pendingRestartRef.current;
    if (!pending) return;
    try {
      await window.codex.setProviderModel({ provider: pending.prevProvider, model: pending.prevModel, apply: false });
      bag.setPendingRestart(null);
      bag.showToast("已撤销切换", "继续使用原供应商");
    } catch (error: any) {
      bag.setNotice(`撤销失败：${error.message}`);
    }
  }
bag.cancelPendingRestart = cancelPendingRestart as typeof bag.cancelPendingRestart;



  async function updateThreadSettings(values: Record<string, unknown>) {
    if (!bag.thread) return;
    // 会话作用域（模型/档位/权限）随每次设置变更一并下发：模型自报「我是谁」必须读会话级，
    // 不能读全局 config.toml 顶层（那是新会话默认值）。取值以本次 values 为准（改档位时
    // 引擎与模型要同时看到新档位）。签名未变时不重复下发（见 pushSessionScope）。
    const scope = await bag.buildSessionScope(bag.thread.id, { ...("model" in values ? { model: values.model } : {}), ...("effort" in values ? { effort: values.effort } : {}) });
    if (scope) bag.scopeSigRef.current[bag.thread.id] = scope.signature;
    // codex app-server 偶尔会重启（切换供应商/启用禁用），重启后内存里没有旧任务，
    // 直接 thread/settings/update 会报 "thread not found"。自动 re-resume 一次再重试。
    const call = () => window.codex.request("thread/settings/update", { threadId: bag.thread!.id, ...values, ...(scope ? { collaborationMode: scope.collaborationMode } : {}) });
    const resume = () => resumeThreadWithTurns({ threadId: bag.thread!.id, excludeTurns: false });
    try {
      await call();
    } catch (error: any) {
      const message = String(error?.message ?? "");
      if (message.includes("thread not found")) {
        try {
          const result = await resume();
          if (result?.thread) {
            const loaded = normalizeLoadedThread(result.thread);
            bag.threadRef.current = loaded;
            bag.setThread(loaded);
          }
          await call();
        } catch (retryError: any) {
          bag.setNotice(retryError?.message ?? message);
        }
      } else {
        bag.setNotice(message);
      }
    }
  }
bag.updateThreadSettings = updateThreadSettings as typeof bag.updateThreadSettings;



  /** 权限推送（sandbox/approval）必须走 thread/resume 的覆盖参数：
   *  thread/settings/update 的 collaboration Settings 只含 model/developer_instructions/
   *  reasoning_effort，协议 schema 里不含 sandbox（09-06 实证：settings/update 传
   *  sandboxPolicy 对象被静默丢弃 → 胶囊显示完全访问但引擎实际还是 workspace-write，
   *  工作区外 git 写 HOME 被 restricted token 拒）。engine 0.150.1 唯一支持会话中途
   *  改 sandbox 的通道 = thread/resume { sandbox, approvalPolicy }（memory：会话权限
   *  优先级 本地每会话 > 全局 default > resume，resume 正是此链条的权威落点）。
   *  excludeTurns:true 只回线程元数据，不拉回合载荷，开销最小。 */
  async function pushThreadPermissions(id: string, sandboxValue: string, approvalValue: string) {
    if (!id) return;
    // 记录推送时间戳：引擎在设置生效后异步回推一条带旧策略的 settings/updated，
    // 时间窗内的回推是旧值，事件侧据此忽略（防止胶囊被打回灰色）。
    bag.threadPermPushAtRef.current.set(id, Date.now());
    // 双通道推送：settings/update 换审批+沙箱策略（0.153.4 实证接受 sandboxPolicy）；
    // 但引擎重启后 settings/update 对已存在线程**不回读 sandbox**（实证 07:19:54：
    // 重启后首个 turn 权限被重置成 workspace-write，settings/update 推了也没生效）——
    // resume 通道才真正接受 sandbox 字符串（schema 实证）。所以补一发带沙箱的 resume
    // 钉住权限（excludeTurns:true 不拉历史，开销极小）。
    const call = () => window.codex.request("thread/settings/update", { threadId: id, approvalPolicy: approvalValue, sandboxPolicy: sandboxPolicy(sandboxValue, bag.workspace), ...(scope ? { collaborationMode: scope.collaborationMode } : {}) });
    // 权限也是会话级配置的一部分：改权限后模型读到的「执行权限」必须是新的（override 传值，
    // 此刻 React 状态还是旧档位）
    const scope = await bag.buildSessionScope(id, { sandbox: sandboxValue, approval: approvalValue });
    if (scope) bag.scopeSigRef.current[id] = scope.signature;
    try {
      await call();
      await window.codex.request("thread/resume", { threadId: id, excludeTurns: true, sandbox: sandboxValue, approvalPolicy: approvalValue });
    } catch (error: any) {
      const message = String(error?.message ?? "");
      // 空会话（还没发过首条消息）没有 rollout，settings/update 会报 "thread not found"——
      // 此时 sandbox 已在 thread/start 创建时按当前偏好写入，无需补救
      if (message.includes("no rollout found") || message.includes("thread not found")) return;
      bag.setNotice(message);
    }
  }
bag.pushThreadPermissions = pushThreadPermissions as typeof bag.pushThreadPermissions;



  function changeApproval(value: string) {
    bag.setApprovalPolicy(value);
    // ⛔ 多会话/多窗口作用域（09-13）：有会话只落该会话，无会话才写全局默认
    // （changeSandbox 同款修法——原实现开着会话也写 default-approval，A 会话切审批
    // 会污染 B 会话的重启兜底与新会话默认）
    if (bag.threadRef.current) {
      saveThreadPermissions(bag.threadRef.current.id, bag.sandbox, value);
      void bag.pushThreadPermissions(bag.threadRef.current.id, bag.sandbox, value);
    } else {
      localStorage.setItem("default-approval", value);
    }
  }
bag.changeApproval = changeApproval as typeof bag.changeApproval;



  /** 权限胶囊的组合档位切换：完全访问 = danger-full-access + never；其余档位 = workspace-write + 对应审批。
   *  不能拆成 changeSandbox/changeApproval 先后调——两个 setter 都读旧 state 互相覆盖
   *  （09-04 实证：从完全访问切「变更前确认」只改了审批，沙箱钉死 → 胶囊永远显示完全访问）。 */
  function changePermissionMode(value: string) {
    const sandboxValue = value === "never" ? "danger-full-access" : "workspace-write";
    const approvalValue = value === "never" ? "never" : value;
    bag.setSandbox(sandboxValue);
    bag.setApprovalPolicy(approvalValue);
    // ⛔ 同上：有会话只落会话级（胶囊本就写会话记录），全局默认仅在无会话时更新
    if (bag.threadRef.current) {
      saveThreadPermissions(bag.threadRef.current.id, sandboxValue, approvalValue);
      void bag.pushThreadPermissions(bag.threadRef.current.id, sandboxValue, approvalValue);
    } else {
      localStorage.setItem("default-sandbox", sandboxValue);
      localStorage.setItem("default-approval", approvalValue);
    }
  }
bag.changePermissionMode = changePermissionMode as typeof bag.changePermissionMode;
  return { chooseModel, migrateThreadToProvider, alignThreadToProvider, applyPendingRestart, cancelPendingRestart, updateThreadSettings, pushThreadPermissions, changeApproval, changePermissionMode };
}
