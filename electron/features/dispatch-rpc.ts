/**
 * dispatch-rpc（09-21 架构改造：从 electron/main.ts 组合根按符号拆出，纯搬迁）
 *
 * 搬出符号：ensureDispatchHttp / dispatchRpcCall
 *
 * 代码与原地逐字一致（仅顶部 import + 文件头注释）。
 * 跨域符号经 `import … from "../main"` 取用 —— **活绑定**（TS→CJS 编译成 `main_1.X` 属性访问）。
 * 会被重新赋值的符号经 `mutableState` 访问器读写（ESM 里 import 的绑定不可赋值）。
 */
import http from "node:http";
import fsp from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { canDispatchFrom } from "../dispatch";
import { broadcastHarnessEvent } from "../features/window-bus";
import type { DispatchKind } from "../dispatch";
import { DISPATCH_FIXED_PORT, dispatchMcpTools, dispatchProbes, dispatchToken, ensureDispatchToken, restrictedThreadRole, stableKey } from "../features/dispatch-core";
import { normalizeTeamConfig, readExpertTeams, writeExpertTeams } from "../expert-teams";
import { readConnectors } from "../main";
import { voiceService } from "../main";
import { loadVoiceSettings } from "../voice/voice-settings";
import { encodeWav16 } from "../voice/voice-profiles";
import { writeConnectors } from "../connector-store";
import { boardsFileOf, readWorkflowBoards, writeWorkflowBoards } from "./drama-workflow-boards";
import { readSubAgents, writeSubAgents } from "../main/09-agents-plugins";
import { runDelegatedTask } from "../features/delegation";
import { delegateRegistry, server, threadCwd, threadRuntimeStore } from "../runtime-refs";
import { mutableState, readBuiltinPlugins, scheduler } from "../main";
import { generateImageResilient } from "./builtin-ipc";
import { uiverseSearch, uiverseGet } from "./uiverse-library";
import { concatVideosCore, downloadVideoCore, findVideoJob, listVideoJobs, pollVideoCore, rememberVideoJob, submitVideoCore, updateVideoJob, videoProviderViews } from "./video-gen";
import { backoffMs, clearPollAbort, isPollAborted, normalizePollConfig, readPollConfig } from "../poll-config";
/** 轮询等待用（10-09）：主进程里 sleep 不受 Chromium 后台节流影响，wait 循环的间隔才准。 */
function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(Number(ms) || 0))));
}

/**
 * 可打断的等待（10-09）：切成 250ms 小段，段间看一眼中止闸。
 * ⛔ 不能一觉睡满整个间隔 —— 间隔可能配到 2 分钟，用户按了「中止」却要等两分钟才停，
 *    那就不叫"随时中止"了（面板上的按钮会像点了没反应）。
 */
async function sleepUntilPolled(taskId: string, ms: number): Promise<void> {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const step = 250;
  for (let waited = 0; waited < total; waited += step) {
    await sleepMs(Math.min(step, total - waited));
    if (isPollAborted(taskId)) return;
  }
}

export async function dispatchRpcCall(name: unknown, args: Record<string, unknown>, explicitCallerThreadId?: string): Promise<{ ok: boolean; output?: string; error?: string }> {
  /* ── 调用者身份有两条来源，**都要**是引擎侧的事实，模型伪造不了：
     · 旁证路径（内置 MCP，`explicitCallerThreadId` 不传）：引擎把调用转发给 MCP 服务器的同一时刻
       会发 item/started 事件（含真实 threadId）。用「参数指纹」对上号。
     · 显式路径（10-05 能力网关，见文件末尾 dispatchGatewayTools）：渲染层从 `item/tool/call` 的
       `params.threadId` 直接带过来 —— **更硬**（不用等旁证、也不会被同名参数撞车），且省掉最多 10 秒等待。 */
  const argsKey = stableKey(args);
  let callerThreadId = String(explicitCallerThreadId ?? "");
  if (!callerThreadId) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const hit = [...dispatchProbes].reverse().find((probe) => probe.argsKey === argsKey && Date.now() - probe.at < 120_000);
      if (hit) { callerThreadId = hit.threadId; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!callerThreadId) return { ok: false, error: "安全校验失败：引擎事件里找不到这次调用" };
  }

  if (name === "agent_invoke") {
    const originDispatch = (await threadRuntimeStore.get(callerThreadId))?.dispatch;
    const restrict = await restrictedThreadRole(callerThreadId);
    const originRecord = await delegateRegistry.infoOf(callerThreadId);
    const gate = canDispatchFrom({
      isDelegated: Boolean(originRecord),
      depth: originRecord?.depth ?? 0,
      holdsLock: originDispatch?.enabled === true,
      restricted: restrict.restricted,
      restrictedLabel: restrict.label,
    });
    if (!gate.ok) return { ok: false, error: gate.reason };
    const result = await runDelegatedTask({
      kind: String(args.kind ?? "") as DispatchKind,
      name: String(args.name ?? ""),
      query: String(args.query ?? ""),
      originThreadId: callerThreadId,
      cwd: args.cwd ? String(args.cwd) : undefined,
      model: args.model ? String(args.model) : undefined,
      effort: args.effort ? String(args.effort) : undefined,
      sandbox: args.sandbox ? String(args.sandbox) : undefined,
      approvalPolicy: args.approvalPolicy ? String(args.approvalPolicy) : undefined,
    });
    return result.ok ? { ok: true, output: result.output } : { ok: false, error: result.error ?? "调度失败" };
  }
  if (name === "agent_archive_sessions") {
    const ids = Array.isArray(args.threadIds) ? args.threadIds.map(String) : [];
    // ⛔ 必须真调引擎的 thread/archive（09-16 用户实测：只标登记表的话侧栏会话不消失）。
    // 与 agents:archive IPC 同一条链路：引擎归档 + 登记表标记 + 广播刷新。
    let archived = 0;
    const failed: string[] = [];
    for (const id of ids) {
      try {
        const record = await delegateRegistry.infoOf(id);
        if (!record || record.archived) continue;
        /* ⛔ 10-05 归属校验：`threadIds` 是模型可控参数，原来只要登记表里有这条就归档
           ⇒ 能归档**别的会话**派出的委托（越权）。收口到「**本会话派出的**」。
           ⛔ 比对的是 `callerThreadId`（引擎旁证认定的调用者）而**不是** `args.originThreadId`
           —— 后者是模型自己填的，拿它当判据等于让模型自己证明自己。 */
        if (record.originThreadId !== callerThreadId) { failed.push(id); continue; }
        await server.request("thread/archive", { threadId: id });
        await delegateRegistry.markArchived([id]);
        archived += 1;
      } catch { failed.push(id); }
    }
    const remaining = await delegateRegistry.listByOrigin(callerThreadId).catch(() => []);
    broadcastHarnessEvent({ type: "delegates-changed" } as any);
    const hint = failed.length ? `（${failed.length} 个失败：不属于本会话或引擎拒绝）` : remaining.length ? `（还有 ${remaining.length} 个未归档）` : "";
    return { ok: true, output: `已归档 ${archived} 个调度会话${hint}。` };
  }
  /* ── 定时任务四件套（09-28）：模型侧真入口 ──────────────────────────────────────
     此前 scheduler 的 4 个通道只有界面 IPC（agent 没有桥）⇒ 用户在会话里说「每天给我
     AI 早报」，模型只能引导去界面。现在走内置调度 MCP 暴露（引擎级注入，覆盖所有会话）。
     安全：scheduler_save 走 restrictedThreadRole 同源闸（专家/被调度会话不许建 —— 防套娃：
     专家安排任务、任务再调专家）；工作区缺省 = 调用者会话的 cwd（threadCwd）。 */
  /* ── 知识库检索（10-01 立项）：模型直接查项目知识库 ────────────────────────────
     workspace 缺省 = 调用者会话的 cwd（threadCwd）。调 knowledge-base 的 searchDocs 同源。 */
  if (name === "knowledge_search") {
    const cwd = threadCwd.get(callerThreadId) || "";
    if (!cwd.trim()) return { ok: false, error: "无法确定工作目录 —— 知识库是项目级的，请先在会话里选择工作文件夹" };
    const { searchDocs } = await import("../knowledge-base");
    const hits = searchDocs(cwd, String(args.query ?? ""), Number(args.limit) || 8);
    /* ⛔⛔ 不接 Laya 相关性过滤（2026-10-05 校准定案，scripts/calibrate-laya-kb.mjs）：
       三种问法实测模型把**一切候选都判相关**（不相关候选置信高达 0.80~0.94）——
       multilingual checkpoint 对「主题相关」这类判断系统性偏置，接上只会随机丢真命中。
       检索质量由全文/语义分负责；Laya 只做校准通过的判断（写入门禁 / 重复拦截）。 */
    return { ok: true, output: hits.length ? hits.map((h) => `【${h.title} · 第 ${h.chunkIndex + 1} 块】${h.snippet}`).join("\n\n") : "（知识库没有命中——确认相关文档已导入，或换个关键词）" };
  }
  /* ── 知识库写入（2026-10-04）：此前**模型侧没有任何写入工具**（只读）——
     执行端与 knowledge_search 同源（同一个 knowledge-base.ts，workspace 缺省 = 调用者 cwd）。
     ⚠️ 权限闸与 scheduler_save 同源（restrictedThreadRole）：专家 / 被调度会话不许写
     —— 被委派的模型能改项目知识库是越权。
     ⛔ 同名不覆盖（safeId 带时间戳）⇒ 这里**主动检出同名并回报**，让模型换标题或明确"要存两份"，
     不静默堆同名垃圾（会让检索结果被重复条目占满、白烧 token）。 */
  if (name === "knowledge_add") {
    const restrict = await restrictedThreadRole(callerThreadId);
    if (restrict.restricted) return { ok: false, error: `当前会话（${restrict.label}）不允许写入知识库` };
    const cwd = String(args.workspace ?? threadCwd.get(callerThreadId) ?? "");
    if (!cwd.trim()) return { ok: false, error: "无法确定工作目录 —— 知识库是项目级的，请在参数里传 workspace" };
    const title = String(args.title ?? "").trim();
    const text = String(args.text ?? "");
    if (!title) return { ok: false, error: "缺少 title" };
    if (!text.trim()) return { ok: false, error: "缺少 text（内容为空，写了也检索不到任何东西）" };
    /* ── Laya 写入门禁（10-04 用户拍板「未装照旧、装了增强」；阈值与问法来自
       2026-10-05 校准 scripts/calibrate-laya-kb.mjs：knowledge/chatter 两分类问法下
       真知识 6/6 判对（0.79+）、阈值 0.5 拦 4/6 废话且**误杀 0**——v1 问法会把
       真知识全判 junk，⛔ 改问法必须重跑校准）。判 chatter ⇒ 拒写并说明。
       ⛔ fail-open：未装 / 未就绪 / 超时 / 低置信 / 判定异常一律放行——门禁绝不能丢知识。 */
    try {
      const { layaJudge } = await import("./laya-service");
      const verdict = await layaJudge(`${title}\n${text}`, {
        instructions: "下面是一条用户想让 AI 存进项目知识库的内容。判断它属于哪一类。",
        criteria: {
          knowledge: "项目知识：开发规范、技术结论、踩坑经验、配置或接口说明、决策记录，有实质信息量。",
          chatter: "非知识：寒暄、闲聊、情绪表达、口头招呼、无实义内容。",
        },
      }, { minConfidence: 0.5 });
      if (verdict?.choice === "chatter") {
        return {
          ok: false,
          error: `未写入知识库：Laya 判定该内容价值低、不适合长期保存（置信 ${(verdict.confidence * 100).toFixed(0)}%）。若它确实值得保存，请充实内容（补充背景/结论/来源）后重试，或让用户在「知识库」页手动添加。`,
        };
      }
    } catch { /* 门禁失败不拦写入 */ }
    const { addDocument, listDocs, searchDocs } = await import("../knowledge-base");
    /* ── Laya 重复拦截（10-04 用户拍板升级）：同名检查只能挡同标题，**换了标题的重复内容照样堆**
       （工具描述里自己承认的坑）。写入前拿「标题 + 正文开头」全文捞最像的 3 条，让 Laya 一次调用
       逐条判 duplicate/new；判 duplicate ⇒ 拒写并给出已有条目，让模型去更新表述或换标题。
       ⛔ fail-open：捞不到候选 / Laya 未就绪 / 低置信 / 异常一律放行——门禁绝不能丢知识。 */
    try {
      const { layaJudgeAll } = await import("./laya-service");
      const similar = searchDocs(cwd, `${title} ${text.slice(0, 300)}`, 3);
      if (similar.length) {
        const questions: Record<string, { instructions: string; criteria: Record<string, string> }> = {};
        similar.forEach((h, i) => {
          questions[String(i)] = {
            instructions: `已有知识条目：【${h.title}】${h.snippet.slice(0, 200)}\n新写入内容：\n${(`${title}\n${text}`).slice(0, 800)}\n判断新内容相对这条已有条目是否重复。`,
            criteria: {
              duplicate: "重复：讲的是同一件事，已有条目已覆盖，没有新增信息",
              new: "新知识：内容不同或有新增信息，值得另存一条",
            },
          };
        });
        const verdicts = await layaJudgeAll(`${title}\n${text}`, questions, { minConfidence: 0.5, timeoutMs: 3_000 });
        const dupIdx = Object.keys(verdicts).find((k) => verdicts[k]?.choice === "duplicate");
        if (dupIdx !== undefined) {
          const hit = similar[Number(dupIdx)];
          return {
            ok: false,
            error: `未写入知识库：Laya 判定与已有文档《${hit.title}》重复（置信 ${(verdicts[dupIdx].confidence * 100).toFixed(0)}%）。若确有新信息请改写正文突出增量后重试；若只是想更新，已有条目不会覆盖（docId 见检索），请换用带日期的标题。`,
          };
        }
      }
    } catch { /* 重复拦截失败不拦写入 */ }
    // ⛔ 先查同名：同名会**新增**一条（safeId 带时间戳），不报错 ⇒ 重复条目会悄悄堆起来
    const dup = listDocs(cwd).find((d) => d.title === title);
    const meta = addDocument(cwd, { title, text, source: String(args.source ?? "模型写入") });
    /*⛔⛔ 补向量索引（2026-10-04 用户问「读和写还有索引工具都有了吧」查出来的缺口）：
       补向量原来**只在 UI 两条路径**（kb:add-text / kb:add-files）里调，
       模型这条路绕过了它 ⇒ **模型写进去的知识只有全文索引、没有向量索引**，
       语义检索（`semantic: true`）永远召不回 —— 而用户看不到任何报错。
       ⚠️ 只在**本地嵌入后端已装**时补：`dispatch-rpc` 拿不到 `secure`（那是宿主能力接缝，
       只用于解密供应商 API Key 做回落），而本地后端是**完全离线**的、不要 secure。
       ⇒ 未装后端时如实告诉用户"当前只有全文索引"，不假装已经全索引了。 */
    let indexed = false;
    try {
      const { kbEmbeddingInstalled } = await import("./kb-embed-backend");
      if (kbEmbeddingInstalled()) {
        const { embedInBackground } = await import("./knowledge-base-ipc");
        // ⛔ secure 传 null（不是假造一个）：本地后端分支**完全不读** secure，
        //   而拿不到 secure 就意味着没法做供应商回落 —— 那种情况如实报错更好。
        embedInBackground(null, cwd, [meta.id]);
        indexed = true;
      }
    } catch { /* 补向量失败只影响语义档，全文检索照常 —— 不阻断写入 */ }
    return {
      ok: true,
      output: `已写入知识库：${meta.title}（${meta.chunks} 块，docId=${meta.id}）`
        + (dup ? `。⚠️ 已存在同名文档（docId=${dup.id}），本次**新增**了一条而非覆盖 —— 若只是更新，请改用带日期的标题避免重复。` : "")
        + (indexed
          ? "。已在后台补语义向量索引（稍候片刻即可被语义检索召回）。"
          : "。⚠️ 未装本地嵌入后端 ⇒ **只有全文索引**；语义检索召不到这条（全文检索不受影响）。"),
    };
  }
  if (name === "scheduler_save") {
    const restrict = await restrictedThreadRole(callerThreadId);
    if (restrict.restricted) return { ok: false, error: `当前会话（${restrict.label}）不允许创建定时任务` };
    const cwd = String(args.workspace ?? threadCwd.get(callerThreadId) ?? "");
    if (!cwd.trim()) return { ok: false, error: "无法确定工作目录 —— 请在参数里传 workspace" };
    if (args.scheduleType === "once" && !String(args.scheduledAt ?? "").trim()) return { ok: false, error: "一次性任务必须传 scheduledAt（ISO 8601 带时区）" };
    if (args.scheduleType === "recurring" && !String(args.rrule ?? "").trim()) return { ok: false, error: "周期任务必须传 rrule（如 FREQ=DAILY;BYHOUR=9;BYMINUTE=0）" };
    // 会话目标：\"current\" = 调用者自己的会话（模型不用猜 id）；其它值原样交给引擎（到点 thread/resume，
    // 失败降级新建并留 lastError）。缺省 = 新建会话。
    const rawThreadId = String(args.threadId ?? "").trim();
    const threadId = rawThreadId === "current" ? callerThreadId : rawThreadId || undefined;
    if (rawThreadId === "current" && !threadId) return { ok: false, error: "无法确定当前会话 id —— 请改为新建会话（不传 threadId）" };
    const deliverTo = String(args.deliverTo ?? "").trim();
    const task = await scheduler.save({
      name: String(args.name ?? ""),
      prompt: String(args.prompt ?? ""),
      workspace: cwd,
      threadId,
      model: args.model ? String(args.model) : undefined,
      scheduleType: args.scheduleType === "recurring" ? "recurring" : "once",
      scheduledAt: args.scheduledAt ? String(args.scheduledAt) : undefined,
      rrule: args.rrule ? String(args.rrule) : undefined,
      enabled: true,
      deliver: args.deliverWeixin ? (deliverTo ? { channel: "weixin", to: deliverTo } : { channel: "weixin" }) : undefined,
    });
    const where = threadId ? `会话 ${threadId} 里续聊执行` : "新建会话执行";
    const notify = args.deliverWeixin ? `；完成后微信推送给${deliverTo ? `「${deliverTo}」` : "最近对话用户"}` : "";
    return { ok: true, output: `定时任务已创建：「${task.name}」（id=${task.id}）下次运行：${task.nextRunAt ? new Date(task.nextRunAt).toLocaleString("zh-CN") : "无"}，在${where}${notify}。可在 设置 → 定时任务 里查看与管理。` };
  }
  if (name === "scheduler_list") {
    const list = await scheduler.list();
    if (!list.length) return { ok: true, output: "当前没有任何定时任务。" };
    return {
      ok: true,
      output: list.map((t) => {
        const plan = t.scheduleType === "once" ? `一次性 @ ${t.scheduledAt ?? ""}` : `RRULE ${t.rrule ?? ""}`;
        const next = t.nextRunAt ? new Date(t.nextRunAt).toLocaleString("zh-CN") : "已结束";
        const state = !t.enabled ? "已停用" : t.running ? "运行中" : "待运行";
        return `${t.enabled ? "▶" : "⏸"} ${t.name} | ${plan} | 下次=${next} | ${state} | id=${t.id}${t.lastError ? ` | 上次错误：${t.lastError}` : ""}`;
      }).join("\n"),
    };
  }
  if (name === "scheduler_run") {
    await scheduler.runNow(String(args.id ?? ""));
    return { ok: true, output: "已手动触发 —— 任务的工作区会话里会出现真实回合，完成后按任务配置决定是否推送微信。" };
  }
  if (name === "scheduler_delete") {
    await scheduler.remove(String(args.id ?? ""));
    return { ok: true, output: "定时任务已删除。" };
  }
  /* ── Uiverse 组件库两件套（10-01）：数据端 uiverse-library.ts（与控件皮肤库同一份 gzip）── */
  if (name === "ui_component_search") {
    const limit = args.limit ? Number(args.limit) : undefined;
    const r = uiverseSearch({ cat: args.cat ? String(args.cat) : undefined, query: args.query ? String(args.query) : undefined, limit });
    const lines = r.items.map((it) => `${it.cat}/${it.id} — ${it.name}（by ${it.author}）`);
    const head = `共 ${r.total} 个匹配${limit && r.items.length < r.total ? `（显示前 ${r.items.length} 条，可加 limit 或收紧关键词）` : ""}。要代码就用 ui_component_get 传 cat/id。`;
    return { ok: true, output: [head, r.error ? `⚠ ${r.error}` : "", ...lines].filter(Boolean).join("\n") || "没有匹配的组件。" };
  }
  if (name === "ui_component_get") {
    const r = uiverseGet({ cat: String(args.cat ?? ""), id: String(args.id ?? "") });
    if (r.error || !r.item) return { ok: false, error: r.error ?? "组件不存在" };
    const body = r.item.html.length > 32_000 ? `${r.item.html.slice(0, 32_000)}\n<!-- ⚠ 已截断（原文 ${r.item.html.length} 字符，异常超大） -->` : r.item.html;
    return { ok: true, output: `<!-- Uiverse "${r.item.name}" by ${r.item.author}（MIT）cat=${r.item.cat} id=${r.item.id} -->\n${body}` };
  }
  /* ── 媒体生成三件套（09-29 用户：「让 Codex 能够直接调用这两个工作流」）────────────────
     ⛔ 执行端与画布卡片**共用同一套 core**（generateImageResilient / video-gen 的 submit·poll·download）
        —— 同一动作两套实现是本仓反复踩过的坑（文案漂移、行为不一致、修一处漏一处）。
     ⛔ 视频必须两段式：提交立刻返回 jobId（不能阻塞回合），查询另一次调用；jobId 由主进程落盘，
        关画布 / 重启应用都能续查。 */
  if (name === "expert_save") {
    const team = normalizeTeamConfig({
      displayName: { zh: String(args.displayNameZh ?? ""), en: String(args.displayNameEn ?? "") },
      profession: { zh: String(args.profession ?? "") },
      description: { zh: String(args.description ?? "") },
      category: args.category ? String(args.category) : undefined,
      sop: String(args.sop ?? ""),
      lead: { name: String(args.leadName ?? ""), systemPrompt: String(args.leadSystemPrompt ?? "") },
      members: Array.isArray(args.members) ? args.members : [],
      quickPrompts: Array.isArray(args.quickPrompts) ? args.quickPrompts.map((q: unknown) => ({ zh: String(q) })) : [],
    });
    if (!team.lead?.name || !String(team.lead?.systemPrompt ?? "").trim()) {
      return { ok: false, error: "lead 的 name 与 systemPrompt 必填（专家没有系统提示词就无法工作）" };
    }
    const list = await readExpertTeams();
    const existed = list.some((entry) => entry.teamId === team.teamId);
    const next = existed ? list.map((entry) => (entry.teamId === team.teamId ? team : entry)) : [team, ...list];
    await writeExpertTeams(next);
    const memberCount = Array.isArray(team.members) ? team.members.length : 0;
    return { ok: true, output: `已${existed ? "更新" : "创建"}专家「${team.displayName?.zh}」（teamId: ${team.teamId}，主理人: ${team.lead?.name}${memberCount ? `，成员 ${memberCount} 名` : ""}）。专家列表在重启应用后可见；用相同 teamId 再次调用即更新。` };
  }
  if (name === "expert_list") {
    const list = await readExpertTeams();
    if (!list.length) return { ok: true, output: "（还没有任何专家/专家团）" };
    const lines = list.map((t) => `- ${t.teamId}｜${t.displayName?.zh ?? "?"}｜${t.profession?.zh ?? ""}｜主理人 ${t.lead?.name ?? "?"}${Array.isArray(t.members) && t.members.length ? `（+${t.members.length} 成员）` : ""}`);
    return { ok: true, output: lines.join("\n") };
  }
  if (name === "subagent_save") {
    const list = await readSubAgents();
    const now = new Date().toISOString();
    const agentName = String(args.name ?? "").trim();
    if (!agentName) return { ok: false, error: "name 必填" };
    const config = {
      id: agentName, name: agentName,
      description: String(args.description ?? "").trim() || `由「${agentName}」负责的子任务`,
      systemPrompt: String(args.systemPrompt ?? "").trim(),
      effort: String(args.effort ?? "high"),
      inheritModel: true, inheritSandbox: true, inheritApproval: true,
      enabled: true,
      createdAt: list.find((entry) => entry.id === agentName)?.createdAt ?? now,
      updatedAt: now,
    };
    const existed = list.some((entry) => entry.id === agentName);
    const next = existed ? list.map((entry) => (entry.id === agentName ? config : entry)) : [config, ...list];
    await writeSubAgents(next);
    return { ok: true, output: `已${existed ? "更新" : "创建"}子智能体「${agentName}」（id: ${agentName}）。列表在重启应用后可见。` };
  }
  if (name === "voice_generate") {
    const text = String(args.text ?? "").trim();
    if (!text) return { ok: false, error: "text 必填（要合成的台词）" };
    const result = await voiceService.speak(text, {
      sid: args.sid ? Number(args.sid) : undefined,
      speed: args.speed ? Number(args.speed) : undefined,
    });
    if (!result.ok) return { ok: false, error: `${result.error ?? "语音合成失败"}（本地 TTS 模型未下载时到「设置 → 语音」下载）` };
    const wav = encodeWav16(result.samples, result.sampleRate);
    const dir = path.join(String(args.workspace || threadCwd.get(callerThreadId) || process.cwd()), "voice");
    await fsp.mkdir(dir, { recursive: true });
    const base = String(args.name ?? "").trim().replace(/[\\/:*?"<>|]/g, "_") || `voice-${Date.now()}`;
    const file = path.join(dir, `${base}.wav`);
    await fsp.writeFile(file, wav);
    return { ok: true, output: `配音已生成：${file}（${result.sampleRate}Hz，${(wav.length / 1024).toFixed(0)} KB）` };
  }
  /* ── 语音播报（10-09 用户：「记得配套对应工具，没工具他调用不了」）──────────────────
     此前模型在播报这件事上**只能被动**：内容写进 ```voice 稿里等回合结束，中途喊停没有闸。
     这两个工具补上「现在就说」与「立刻闭嘴」。
     ⛔ 为什么**不在主进程直接放音**：主进程没有扬声器出口（`voiceService.speak` 只到 PCM），
        出声靠渲染层的 AudioContext 队列（语音播报 hook）——那边同时负责「播报中」状态条与
        停止按钮。⇒ 主进程广播一条 harness:event由渲染层执行，**立刻返回**（等念完会把回合卡几秒）。
     ⛔ 通话中拒绝（不是"可能冲突"而是**必然**出事）：通话链路独占扬声器且要喂 AEC 参考环，
        两条同时放 ⇒ 用户听到自己改造的回声，且停止按钮管不到通话那一路。
     ⛔ 返回值必须与事实相符：这里只证明"已提交"，没证明"听到了"⇒ 不说「已念给用户听」。 */
  if (name === "voice_announce" || name === "voice_announce_stop") {
    if (name === "voice_announce_stop") {
      broadcastHarnessEvent({ type: "voice-announce", action: "stop", threadId: callerThreadId });
      return { ok: true, output: "已请求停止播报：正在念的与排队待念的都已清掉（回复文字不受影响）。" };
    }
    const text = String(args.text ?? "").trim();
    if (!text) return { ok: false, error: "text 必填（要念的那句话）" };
    /* 上限刻意比 voice_generate 严得多（那边是配音合成，这里是**插播一句话**）：
       120 字大概念 20 秒出头，再长就不是插播了 —— 用户既插不上话，也退不出排队。 */
    if (text.length > 120) return { ok: false, error: `text 过长（${text.length} 字）：插播一句话即可，请压到 120 字以内（要念长内容就写进回复正文或回复末尾的播报稿）` };
    let status: any = null;
    try { status = voiceService?.status?.() ?? null; } catch { status = null; }
    if (status?.active) {
      return { ok: false, error: "当前正在实时语音通话中，扬声器由通话链路独占 —— 直接把话写进回复即可（通话会把回复念出来），不要用这个工具插播。" };
    }
    const speed = Number(args.speed);
    broadcastHarnessEvent({
      type: "voice-announce",
      action: "speak",
      text,
      speed: Number.isFinite(speed) && speed > 0 ? speed : undefined,
      threadId: callerThreadId,
    });
    return {
      ok: true,
      output: `已提交播报（本地合成 + 播放由界面完成）：「${text}」。⚠️ 这是即时发送、不等回执 —— 本地语音模型未下载或窗口不在前台时不会出声（工具不会报错），也别据此向用户声称「已经说给你听了」。⛔ 这句是**说给耳朵**的：正文里**别再原样复述**（同一句会被念两遍，用户听着像复读）。`,
    };
  }
  if (name === "voice_speak_reply") {
    /* Codex 决定「这一条回复念出来」（10-09 第五轮，用户：「正文输出也可以进行播报，但不是每条
       都需要，完全由 codex 决定」）。⛔ 传文本进来既浪费 token 又会与正文不一致 ⇒ 这里只广播一个
       **标记本回合**的信号，正文由渲染层按流式增量念（它是唯一能看到正文的地方）。 */
    let status: any = null;
    try { status = voiceService?.status?.() ?? null; } catch { status = null; }
    if (status?.active) {
      return { ok: false, error: "当前正在实时语音通话中 —— 通话会自己把回复念出来，不需要这个工具。" };
    }
    /* ⛔ 总开关关着 ⇒ 拒绝并说清：不然模型以为念了、用户什么都没听到（比静默失败更糟的是"谎报成功"）。 */
    if (loadVoiceSettings(app.getPath("userData")).announce.enabled === false) {
      return { ok: false, error: "用户的「语音播报」总开关是关着的 —— 现在别念正文（用户不想听）。" };
    }
    broadcastHarnessEvent({ type: "voice-announce", action: "speak-reply", threadId: callerThreadId });
    return {
      ok: true,
      output: "已请求：本条回复的正文会在生成过程中逐句念给用户听（本地语音模型未下载或窗口不在前台时不会出声；用户可以随时点「停止播报」掐断）。",
    };
  }
  if (name === "connector_register") {
    const id = String(args.id ?? "").trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
    const displayName = String(args.name ?? "").trim();
    const command = String(args.command ?? "").trim();
    if (!id || !displayName) return { ok: false, error: "id 与 name 必填" };
    if (!command) return { ok: false, error: "command 必填（MCP server 的启动命令）" };
    const list = await readConnectors();
    const previous = list.find((entry) => entry.id === id);
    const now = new Date().toISOString();
    const config = {
      id, name: displayName, transport: "stdio" as const,
      command,
      args: Array.isArray(args.args) ? args.args.map((value: unknown) => String(value).trim()).filter(Boolean) : [],
      env: args.env && typeof args.env === "object" ? Object.fromEntries(Object.entries(args.env as Record<string, unknown>).map(([key, value]) => [String(key).trim(), String(value ?? "")]).filter(([key]) => key)) : undefined,
      enabled: true,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    await writeConnectors([...list.filter((entry) => entry.id !== id), config]);
    // ⛔ 不做热更新（用户明确：重启应用即可）——注册完提示用户重启，不中断当前回合
    return { ok: true, output: `连接器「${displayName}」（${id}）已注册。请提示用户**重启应用**；重启后的新会话里 tools/list 会带上它的工具，届时即可直接调用。` };
  }
  if (name === "workflow_read") {
    const all = await readWorkflowBoards();
    const names = Object.keys(all);
    if (!names.length) return { ok: true, output: "（画布还没有镜像快照 —— 用户打开过画布并编辑后才有；请让用户打开一次 AI 画布工作流）" };
    const parts: string[] = [];
    for (const canvasName of names) {
      const board = all[canvasName] as { flow?: string; nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>>; updatedAt?: string };
      parts.push(`## 画布「${canvasName}」（${board.flow || "?"}，更新于 ${board.updatedAt ?? "?"}）`);
      for (const nd of board.nodes ?? []) {
        const p = (nd.payload ?? {}) as Record<string, unknown>;
        const bits = [`id=${nd.id}`, `类型=${nd.kind}`, `标题=${String(p.title ?? "")}`];
        for (const key of ["prompt", "size", "negative", "count", "imageType", "aspect", "duration", "variant", "act", "hint", "step", "shot_size", "motion", "line", "speaker", "first_frame", "video", "audio", "ref_video"]) {
          if (p[key] !== undefined && String(p[key]).trim()) bits.push(`${key}=${String(p[key]).slice(0, 120)}`);
        }
        if (p.path) bits.push(`已有产物=${String(p.path)}`);
        if (p.ref) bits.push(`参考图=${String(p.ref)}`);
        parts.push(`  · ${bits.join("｜")}`);
      }
      const edges = (board.edges ?? []).map((ed) => `${String(ed.source)}→${String(ed.target)}`).join("；");
      if (edges) parts.push(`  连线：${edges}`);
    }
    return { ok: true, output: parts.join("\n") };
  }
  if (name === "workflow_writeback") {
    const nodeId = String(args.nodeId ?? "").trim();
    const updates = (args.updates && typeof args.updates === "object") ? args.updates as Record<string, unknown> : null;
    if (!nodeId) return { ok: false, error: "nodeId 必填（从 workflow_read 输出里拿）" };
    if (!updates) return { ok: false, error: "updates 必填（要写回的字段对象）" };
    const clean: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (typeof value === "string" || typeof value === "number") clean[key] = value;
    }
    if (!Object.keys(clean).length) return { ok: false, error: "updates 的值必须是字符串或数字" };
    const all = await readWorkflowBoards();
    const names = Object.keys(all);
    if (!names.length) return { ok: false, error: "没有画布镜像（用户打开过画布后才有）" };
    const canvasName = String(args.canvas ?? "").trim() || names.slice().sort((x, y) => String((all[y] as Record<string, unknown> | undefined)?.updatedAt ?? "").localeCompare(String((all[x] as Record<string, unknown> | undefined)?.updatedAt ?? "")))[0];
    const board = all[canvasName] as { nodes?: Array<Record<string, unknown>> } | undefined;
    if (!board) return { ok: false, error: `画布「${canvasName}」不存在；可用：${names.join("、")}` };
    const node = (board.nodes ?? []).find((nd) => String(nd.id) === nodeId || String((nd.payload as Record<string, unknown> | undefined)?.title ?? "") === nodeId);
    if (!node) return { ok: false, error: `节点 ${nodeId} 不在画布「${canvasName}」上；用 workflow_read 看节点清单` };
    node.payload = { ...((node.payload ?? {}) as Record<string, unknown>), ...clean };
    await writeWorkflowBoards(all);
    broadcastHarnessEvent({ type: "drama-canvas-writeback", name: canvasName, nodeId: String(node.id), updates: clean });
    return { ok: true, output: `已写回画布「${canvasName}」节点 ${nodeId}：${JSON.stringify(clean)}。用户画布打开着会实时看到并弹提示。` };
  }
  if (name === "image_generate") {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) return { ok: false, error: "缺少 prompt（要画什么）" };
    const plugins = (await readBuiltinPlugins().catch(() => null)) as any;
    const cfg = plugins?.image;
    if (!cfg?.baseUrl || !cfg?.apiKey) return { ok: false, error: "生图插件还没配置：到「设置 → 插件 → 内置插件」填 API 地址、密钥与模型" };
    const model = String(args.model || cfg.model || "").trim();
    if (!model) return { ok: false, error: "生图模型没配（设置 → 插件 → 内置插件 的模型字段）" };
    const count = Math.min(4, Math.max(1, Math.floor(Number(args.count) || 1)));
    const cwd = String(args.workspace || threadCwd.get(callerThreadId) || "").trim();
    const results = await Promise.allSettled(
      Array.from({ length: count }, () => generateImageResilient({
        baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model, prompt,
        size: args.size ? String(args.size) : undefined,
        negative: args.negative ? String(args.negative) : undefined,
      })),
    );
    const saved: string[] = [];
    const errors: string[] = [];
    for (const [index, result] of results.entries()) {
      if (result.status !== "fulfilled") { errors.push(String((result.reason as Error)?.message ?? result.reason).slice(0, 140)); continue; }
      let filePath = String(result.value?.path || "");
      // 落进工作区（与画布同一棵树 .drama-canvas/assets/image）；没有工作目录就用 userData/images 那份
      if (cwd && filePath) {
        try {
          const dir = path.join(cwd, ".drama-canvas", "assets", "image");
          await fsp.mkdir(dir, { recursive: true });
          const ext = path.extname(filePath) || ".png";
          const base = String(args.name || "img").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40) || "img";
          const dest = path.join(dir, `${base}-${Date.now()}-${index + 1}${ext}`);
          await fsp.copyFile(filePath, dest);
          filePath = dest;
        } catch { /* 复制失败退回原路径，不影响"图已生成"这个事实 */ }
      }
      if (filePath) saved.push(filePath);
    }
    if (!saved.length) return { ok: false, error: `生成失败：${errors[0] ?? "未知错误"}` };
    const lines = saved.map((file, i) => `${i + 1}. ${file}`).join("\n");
    const tail = errors.length ? `\n（另有 ${errors.length} 张失败：${errors[0]}）` : "";
    const where = cwd ? "" : "\n（未指定工作目录，文件在应用数据目录的 images/ 下）";
    return { ok: true, output: `已生成 ${saved.length}/${count} 张：\n${lines}${tail}${where}` };
  }
  if (name === "video_generate") {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) return { ok: false, error: "缺少 prompt（要拍什么）" };
    const providers = videoProviderViews().filter((view) => view.configured);
    if (!providers.length) return { ok: false, error: "还没有配置任何视频生成接口 —— 到「设置 → 插件 → 视频生成接口」填 API Key" };
    const providerId = String(args.providerId || providers[0].id);
    if (!providers.some((view) => view.id === providerId)) {
      return { ok: false, error: `厂商 ${providerId} 没配凭证。已配置的：${providers.map((v) => `${v.id}（${v.name}）`).join("、")}` };
    }
    const mode = args.mode === "i2v" ? "i2v" : "t2v";
    if (mode === "i2v" && !args.image) return { ok: false, error: "i2v（图生视频）要给 image：本地图片路径或公网 URL" };
    const cwd = String(args.workspace || threadCwd.get(callerThreadId) || "").trim();
    const name = String(args.name || "").trim();
    const { jobId } = await submitVideoCore({
      providerId, mode, prompt,
      image: args.image ? String(args.image) : undefined,
      model: args.model ? String(args.model) : undefined,
      duration: Number(args.duration) || undefined,
      aspect: args.aspect ? String(args.aspect) : undefined,
      video: args.video ? String(args.video) : undefined,
    });
    // 提交即落盘：关画布 / 重启应用后仍可续查（模型与画布卡片共用这份记录）
    rememberVideoJob({
      jobId, providerId, prompt, mode,
      image: args.image ? String(args.image) : undefined,
      workspace: cwd || undefined, name: name || undefined,
      submittedAt: Date.now(),
    });
    const providerName = providers.find((view) => view.id === providerId)?.name ?? providerId;
    /* 提交即开一张轮询卡（10-09）：任务从这一刻起就在厂商那边跑着，用户应该立刻能看见
       「有个异步任务在跑」，而不是等模型第一次调 video_status 才冒出来。
       ⛔ managed:false —— 此刻**没有人在等**（没人循环查询），间隔只能事后实测出来。 */
    broadcastHarnessEvent({
      type: "poll",
      action: "start",
      taskId: jobId,
      threadId: callerThreadId,
      title: `视频生成 · ${providerName}`,
      detail: prompt.slice(0, 120),
      managed: false,
    });
    return { ok: true, output: `已提交给 ${providerName}（${mode === "i2v" ? "图生视频" : "文生视频"}），jobId=${jobId}。\n这是异步任务，通常要几分钟 —— 你可以先做别的事，之后用 video_status 查进度（给这个 jobId）。想一直等到出片就加 wait: true（按「设置」里那套间隔/超时自动轮询，用户可随时中止）。` };
  }
  if (name === "video_status") {
    const jobId = String(args.jobId ?? "").trim();
    if (!jobId) {
      const jobs = listVideoJobs().slice(0, 10);
      if (!jobs.length) return { ok: true, output: "最近没有任何视频任务。" };
      return {
        ok: true,
        output: jobs.map((job) => {
          const when = new Date(job.submittedAt).toLocaleString("zh-CN", { hour12: false });
          const extra = job.path || job.url || job.error || "";
          const mark = job.status === "succeeded" ? "✅" : job.status === "failed" ? "❌" : "⏳";
          return `${mark} ${job.jobId} | ${job.mode} | ${job.providerId} | ${when}${extra ? ` | ${String(extra).slice(0, 120)}` : ""}`;
        }).join("\n"),
      };
    }
    const job = findVideoJob(jobId);
    const providerId = String(args.providerId || job?.providerId || "");
    if (!providerId) return { ok: false, error: `找不到任务 ${jobId} 的厂商记录 —— 请带上 providerId 参数` };
    /* ── 轮询板块（10-09）：把"查一次"变成"看得见的一次查询"，并可选**托管等待** ──────────
       ① 每一次查询都广播一轮（poll:round）⇒ 对话流里那张卡能逐轮记账 —— 模型自己循环调用
          时也一样聚合到同一张卡上（这正是需求要的"轮询过程"，不是 N 张重复的工具卡）；
       ② `wait: true` ⇒ 主进程按配置循环查到出片/失败/超时为止，**查询失败自动重试**
          （指数退避，超过 maxRetry 才判失败），用户可随时中止（poll:abort）。
       ⛔ 终态一律广播 poll:end：卡上要给出结论（成功产物 / 失败原因 / 超时 / 已中止），
          而"还在跑"不广播 end —— 那不是结论。
       ⛔ 成功后照常走原有的下载落盘分支 ⇒ 最终结果仍由模型**正常写进对话**（工具返回值不变）。 */
    const cfg = readPollConfig();
    const wait = args.wait === true || String(args.wait ?? "") === "true";
    const local = normalizePollConfig({ intervalMs: Number(args.intervalMs) || undefined, timeoutMs: Number(args.timeoutMs) || undefined, maxRetry: Number.isFinite(Number(args.maxRetry)) ? Number(args.maxRetry) : undefined }, cfg);
    const providerName = videoProviderViews().find((view) => view.id === providerId)?.name ?? providerId;
    const startedAt = Date.now();
    const emit = (payload: Record<string, unknown>) => broadcastHarnessEvent({ type: "poll", taskId: jobId, threadId: callerThreadId, ...payload });
    emit({
      action: "start",
      title: `视频生成 · ${providerName}`,
      detail: String(job?.prompt ?? "").slice(0, 120),
      intervalMs: local.intervalMs,
      timeoutMs: local.timeoutMs,
      maxRetry: local.maxRetry,
      managed: wait,
    });
    // ⛔ 开等之前先清一次中止登记：上一次 wait 被用户中止过的话，标记会留在表里 ⇒
    //    这次一进来就"已被中止"（明明没人按）。中止只对**这一次**等待生效。
    clearPollAbort(jobId);
    let failures = 0;
    for (;;) {
      // 中止闸：每轮开头查一次（用户按了「中止」就立刻收，不再发下一次查询）
      if (isPollAborted(jobId)) {
        emit({ action: "end", status: "aborted", error: "用户中止了这次轮询" });
        clearPollAbort(jobId);
        return { ok: false, error: `已按用户要求中止轮询（jobId=${jobId}）。任务本身还在厂商那边，之后用同一个 jobId 再查即可，不会被重复提交。` };
      }
      let result: { status: string; url?: string; error?: string } | null = null;
      try {
        result = await pollVideoCore({ providerId, jobId });
        failures = 0;
      } catch (error) {
        failures += 1;
        const reason = String((error as Error)?.message ?? error).slice(0, 160);
        emit({ action: "round", ok: false, error: reason, summary: `查询失败（第 ${failures} 次）` });
        if (failures > local.maxRetry) {
          emit({ action: "end", status: "failed", error: `连续 ${failures} 次查询失败：${reason}` });
          return { ok: false, error: `查询任务失败（已重试 ${local.maxRetry} 次）：${reason}` };
        }
        // 失败自动重试：间隔按指数退避拉长（对方在限流时我们不该继续猛打）
        await sleepUntilPolled(jobId, backoffMs(local.intervalMs, failures));
        continue;
      }
      const status = String(result?.status ?? "");
      const progressText = status === "succeeded" ? "已生成" : status === "failed" ? "生成失败" : "生成中";
      emit({ action: "round", ok: status !== "failed", summary: progressText, progress: progressText });
      if (status === "failed") {
        updateVideoJob(jobId, { status: "failed", error: result?.error });
        emit({ action: "end", status: "failed", error: result?.error ?? "厂商未给原因" });
        return { ok: false, error: `生成失败：${result?.error ?? "厂商未给原因"}` };
      }
      // ⛔ queued / running / pending 都算"还在跑" —— 只有终态才往下走（源里状态枚举比 pending 多）
      if (status !== "succeeded") {
        if (!wait) return { ok: true, output: `任务 ${jobId} 还在生成中（${providerId}）—— 过一会儿再查一次。` };
        if (Date.now() - startedAt >= local.timeoutMs) {
          const waited = Math.round(local.timeoutMs / 1000);
          emit({ action: "end", status: "timeout", error: `已等 ${waited} 秒仍无结果` });
          return { ok: false, error: `等了 ${waited} 秒还没出片（超时上限）。任务可能还在厂商那边跑着 —— 之后用同一个 jobId 再查一次即可，不会重复提交。` };
        }
        await sleepUntilPolled(jobId, local.intervalMs);
        continue;
      }
      const url = String(result.url || "");
      const workspace = String(args.workspace || job?.workspace || threadCwd.get(callerThreadId) || "").trim();
      if (url && workspace) {
        try {
          const name = String(args.name || job?.name || `video-${jobId.slice(0, 8)}.mp4`);
          const saved = await downloadVideoCore({ url, workspace, name });
          updateVideoJob(jobId, { status: "succeeded", url, path: saved.path });
          emit({ action: "end", status: "success", result: saved.path });
          return { ok: true, output: `已生成并落盘：${saved.path}（${(saved.bytes / 1048576).toFixed(1)} MB）` };
        } catch (error) {
          updateVideoJob(jobId, { status: "succeeded", url });
          emit({ action: "end", status: "success", result: url });
          return { ok: true, output: `视频已生成，但下载落盘失败（${(error as Error)?.message ?? error}）。原始地址：${url}` };
        }
      }
      updateVideoJob(jobId, { status: "succeeded", url });
      emit({ action: "end", status: "success", result: url });
      return { ok: true, output: `视频已生成：${url}${workspace ? "" : "（没有工作目录，未落盘；把工作目录给我可以再下载）"}` };
    }
  }
  if (name === "video_concat") {
    // 整片合并（09-29）：把各镜片段按**参数给的顺序**拼成一条成片。
    //   顺序由调用方决定（模型按分镜表排）—— 主进程不猜顺序，猜错比不拼更糟。
    const files = (Array.isArray(args.files) ? args.files : []).map((item) => String(item || "").trim()).filter(Boolean);
    if (!files.length) return { ok: false, error: "缺少 files：要合并的片段路径列表，**按成片顺序**排列" };
    const workspace = String(args.workspace || threadCwd.get(callerThreadId) || "").trim();
    if (!workspace) return { ok: false, error: "没有工作目录：把 workspace 传给我（成片要落盘）" };
    try {
      const result = await concatVideosCore({
        workspace,
        name: String(args.name || "成片"),
        files,
        width: Number(args.width) || undefined,
        height: Number(args.height) || undefined,
        fps: Number(args.fps) || undefined,
      });
      return {
        ok: true,
        output: `成片已导出：${result.path}（${result.parts} 段 · ${(result.bytes / 1048576).toFixed(1)} MB · `
          + `${result.mode === "copy" ? "无损拼接（编码一致）" : "统一重编码（片段编码不一致，已统一画布与帧率）"}）`,
      };
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error) };
    }
  }
  /* ── 3D 预览（2026-10-05）：模型文件路径过闸（可信根 + 扩展名白名单 + 大小上限，
     与 model-viewer:read 同一道 resolveModelPath）→ 推送渲染层打开弹窗。⛔ 只推不读，
     模型字节由渲染层经 model-viewer:read 自己拉（弹窗是用户主动看的界面）。 */
  if (name === "preview_3d") {
    const rawPath = String(args.path ?? "").trim();
    if (!rawPath) return { ok: false, error: "缺少 path（.glb / .gltf 模型文件的绝对路径）" };
    try {
      const { resolveModelPath } = await import("./model-viewer-ipc");
      const file = await resolveModelPath(rawPath);
      const { sendToWindow } = await import("./window-bus");
      sendToWindow("model-viewer:open", { path: file, title: String(args.title ?? "").trim() });
      return { ok: true, output: `已在应用内打开 3D 预览：${file}（弹窗里可旋转/缩放；模型还在原路径，可继续用 Blender 等工具加工）` };
    } catch (error) {
      return { ok: false, error: `无法打开 3D 预览：${String((error as Error)?.message ?? error)}` };
    }
  }
  /* ── 壁纸设置（10-06）：Codex 自助换壁纸的拓展接口。⛔ image 为本地路径时必须过可信根
     （与 model-viewer 同一套 isInsideTrustedRoots）；preset: 前缀交给渲染层校验 id。 */
  if (name === "wallpaper_set") {
    const mode = String(args.mode ?? "");
    if (!["off", "pattern", "particles", "vanta", "custom"].includes(mode)) {
      return { ok: false, error: "mode 只支持 off / pattern / particles / vanta / custom" };
    }
    const opacityNum = Number(args.opacity);
    const opacity = Number.isFinite(opacityNum) ? Math.min(40, Math.max(2, Math.round(opacityNum))) : 16;
    let image = String(args.image ?? "").trim();
    if (mode === "custom") {
      if (!image) return { ok: false, error: "mode=custom 需要 image（`preset:<id>` 或图片绝对路径）" };
      if (!image.startsWith("preset:")) {
        try {
          const { isInsideTrustedRoots } = await import("../runtime-refs");
          const candidate = image;
          if (!/\.(png|jpe?g|webp|gif)$/i.test(candidate)) return { ok: false, error: "壁纸图片只支持 png / jpg / webp / gif" };
          if (!isInsideTrustedRoots(candidate)) return { ok: false, error: "图片路径不在可信目录内（会话工作目录 / 应用数据目录）" };
        } catch (error) {
          return { ok: false, error: `壁纸图片校验失败：${String((error as Error)?.message ?? error)}` };
        }
      }
    }
    const { sendToWindow } = await import("./window-bus");
    sendToWindow("wallpaper:apply", { mode, pattern: String(args.pattern ?? "dots"), opacity, image });
    return { ok: true, output: `壁纸已切换（mode=${mode}${image ? `，image=${image}` : ""}），用户立即可见。` };
  }
  return { ok: false, error: `未知工具：${String(name)}` };
}
export async function ensureDispatchHttp(): Promise<void> {
  if (mutableState.dispatchHttpReady) return mutableState.dispatchHttpReady;
  await ensureDispatchToken(); // 令牌先就绪：/mcp 端点与 config.toml 都要用它
  mutableState.dispatchHttpReady = new Promise<void>((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json; charset=utf-8");
      // ── MCP 协议端点（/mcp，09-16）：引擎用 url 直连（无子进程冷启动，避免 stdio 的
      //    electron 启动 28s > startup_timeout 被判死导致工具不注册）。Streamable HTTP：
      //    POST = JSON-RPC 请求/响应；**GET = SSE 长连接**（引擎 rmcp 客户端必开，缺了会报
      //    "fail to get common stream: Unexpected content type: None"）；DELETE = 会话终止。 ──
      if (req.url?.startsWith("/mcp") && (req.method === "GET" || req.method === "DELETE")) {
        const token = new URL(req.url, "http://x").searchParams.get("token");
        if (token !== dispatchToken) { res.statusCode = 403; res.end(); return; }
        if (req.method === "DELETE") { res.statusCode = 200; res.end(); return; }
        // SSE 流：保持连接（引擎用它收服务端主动消息），定期心跳防中间层断连
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "mcp-session-id": "harness-dispatch" });
        res.write(": connected\n\n");
        const keep = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* 连接已断 */ } }, 25000);
        req.on("close", () => clearInterval(keep));
        return;
      }
      if (req.method === "POST" && req.url?.startsWith("/mcp")) {
        const token = new URL(req.url, "http://x").searchParams.get("token");
        if (token !== dispatchToken) { res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "token 校验失败" } })); return; }
        let body = "";
        req.on("data", (chunk) => { body += chunk; if (body.length > 2_000_000) req.destroy(); });
        req.on("end", async () => {
          let msg: any = null;
          try { msg = JSON.parse(body); } catch { res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })); return; }
          res.setHeader("mcp-session-id", "harness-dispatch");
          const reply = (result: any) => res.end(JSON.stringify({ jsonrpc: "2.0", id: msg?.id ?? null, result }));
          const fail = (message: string) => res.end(JSON.stringify({ jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32000, message } }));
          if (msg?.id === undefined || msg?.id === null) { res.statusCode = 202; res.end(""); return; } // notification
          try {
            if (msg.method === "initialize") {
              reply({ protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "harness-dispatch", version: "1.0.0" } });
              return;
            }
            if (msg.method === "tools/list") { reply({ tools: dispatchMcpTools() }); return; }
            if (msg.method === "ping") { reply({}); return; }
            if (msg.method === "tools/call") {
              const out = await dispatchRpcCall(msg.params?.name, msg.params?.arguments ?? {});
              reply({ content: [{ type: "text", text: out.ok ? String(out.output ?? "") : "调用被拒绝：" + String(out.error ?? "未知原因") }], isError: !out.ok });
              return;
            }
            fail("method not found: " + String(msg.method));
          } catch (error: any) {
            fail(String(error?.message ?? error).slice(0, 300));
          }
        });
        return;
      }
      if (req.method !== "POST" || !req.url?.startsWith("/rpc")) { res.statusCode = 404; res.end(JSON.stringify({ ok: false, error: "not found" })); return; }
      let body = "";
      req.on("data", (chunk) => { body += chunk; if (body.length > 1_000_000) req.destroy(); });
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body) as { token?: string; name?: string; args?: Record<string, unknown> };
          if (!payload.token || payload.token !== dispatchToken) { res.end(JSON.stringify({ ok: false, error: "token 校验失败" })); return; }
          res.end(JSON.stringify(await dispatchRpcCall(payload.name, payload.args ?? {})));
        } catch (error: any) {
          res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error).slice(0, 300) }));
        }
      });
    });
    server.listen(DISPATCH_FIXED_PORT, "127.0.0.1", () => {
      mutableState.dispatchHttpPort = DISPATCH_FIXED_PORT;
      void writeDispatchPortFile(DISPATCH_FIXED_PORT);
      resolve();
    });
    // 端口被占（可能另一个实例/残留进程）：退回相邻端口并记录，config 会用实际端口重写
    server.on("error", () => {
      const fallback = http.createServer(server.listeners("request")[0] as any);
      fallback.listen(0, "127.0.0.1", () => {
        const addr = fallback.address();
        if (addr && typeof addr === "object") {
          mutableState.dispatchHttpPort = addr.port;
          // ⛔ 实际端口落盘（10-01 e2e 实测：用户真实应用占 47120 ⇒ e2e 实例退到随机端口，
          // 验收脚本写死 47120 会打到真实应用上 token 不匹配假红）。与 dispatch-token.txt 同目录。
          void writeDispatchPortFile(addr.port);
        }
        resolve();
      });
    });
    // 立即 resolve 兜底：listen 异常时不能卡死 config 写入（宁可这轮没有 MCP 段）
    setTimeout(resolve, 2000);
  });
  return mutableState.dispatchHttpReady;
}

/** 实际 MCP 端口落盘（验收脚本读它，不再写死 47120——真实应用占口时 e2e 不假红）。 */
async function writeDispatchPortFile(port: number): Promise<void> {
  try {
    await fsp.writeFile(path.join(app.getPath("userData"), "dispatch-port.txt"), String(port), "utf8");
  } catch { /* 写失败不影响服务 */ }
}

/* ── 能力网关（10-05）：把内置 MCP 的工具面**重新**暴露给模型 ────────────────────────────
   背景：引擎 0.157 起内置 MCP 的工具整批「延迟暴露」（`tool_search_always_defer_mcp_tools`
   已是 `removed / true`，属永久默认），它们不再出现在发给模型的工具清单里 ⇒ 直接调用一律
   `unsupported call`。宿主的唯一可见通道是 dynamicTools，而 dynamicTools 只在
   `thread/start` / `thread/resume` 注册（覆盖不了"中途变化"，但覆盖得了所有新会话与切回的老会话）。
   ⇒ 这里把 MCP 工具面**镜像成 1 个网关工具** `harness_tools`，执行端**原样复用**
     `dispatchRpcCall`（同一套实现、同一套闸，不是第二份逻辑）。

   ⛔ 为什么是「一个网关」而不是「19 个独立工具」：
     ① 工具面**每次请求**都要带上 ⇒ 19 份 schema 是常驻 token 成本，还会挤掉真正重要的工具；
     ② 以后主进程新增 MCP 工具时，渲染层**不用改**；
     ③ 参数说明按需取（`name="list"`），不占常驻提示词。
   ⛔ 为什么排除这三个：`agent_invoke` / `agent_archive_sessions` / `image_generate` 已经有
     **专用 dynamicTool**（`generate_image` 等）。同一个能力挂两个名字，模型只会用名字最直白的
     那个、另一套被绕过 —— 项目**踩过一次**：`subagent_invoke` 与 `agent_invoke` 并存时专家/专家团
     永远被绕过，最后整体删除。⛔ 别把这三个加回来。 */
const GATEWAY_EXCLUDED = new Set(["agent_invoke", "agent_archive_sessions", "image_generate"]);

/** 网关暴露的工具面（= MCP 工具面 − 已有专用工具的三个）。 */
export function dispatchGatewayTools(): Array<{ name: string; description: string; inputSchema: unknown }> {
  const all = dispatchMcpTools() as Array<{ name?: unknown; description?: unknown; inputSchema?: unknown }>;
  return all
    .filter((tool) => !GATEWAY_EXCLUDED.has(String(tool?.name ?? "")))
    .map((tool) => ({ name: String(tool?.name ?? ""), description: String(tool?.description ?? ""), inputSchema: tool?.inputSchema ?? {} }));
}

/** `harness_tools({name:"list"})` 的返回：名字 + 一句话说明 + 参数 schema（按需取，不进常驻提示词）。 */
export function dispatchGatewayCatalogText(): string {
  const tools = dispatchGatewayTools();
  const body = tools.map((tool) => `【${tool.name}】${tool.description}\n参数：${JSON.stringify(tool.inputSchema)}`).join("\n\n");
  return `共 ${tools.length} 个能力。调用方式：harness_tools({ name: "<工具名>", args: { … } })。\n\n${body}`;
}
