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
export async function dispatchRpcCall(name: unknown, args: Record<string, unknown>): Promise<{ ok: boolean; output?: string; error?: string }> {
  // ── 旁证：引擎把调用转发给 MCP 服务器的同一时刻会发 item/started 事件（含真实 threadId）。
  // 用「参数指纹」对上号，拿到的才是**引擎认定的调用者**——模型谎报身份也绕不过。
  const argsKey = stableKey(args);
  const deadline = Date.now() + 10000;
  let callerThreadId = "";
  while (Date.now() < deadline) {
    const hit = [...dispatchProbes].reverse().find((probe) => probe.argsKey === argsKey && Date.now() - probe.at < 120_000);
    if (hit) { callerThreadId = hit.threadId; break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!callerThreadId) return { ok: false, error: "安全校验失败：引擎事件里找不到这次调用" };

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
        await server.request("thread/archive", { threadId: id });
        await delegateRegistry.markArchived([id]);
        archived += 1;
      } catch { failed.push(id); }
    }
    const remaining = await delegateRegistry.listByOrigin(String(args.originThreadId ?? "")).catch(() => []);
    broadcastHarnessEvent({ type: "delegates-changed" } as any);
    const hint = failed.length ? `（${failed.length} 个失败）` : remaining.length ? `（还有 ${remaining.length} 个未归档）` : "";
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
    const { addDocument, listDocs } = await import("../knowledge-base");
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
    return { ok: true, output: `已提交给 ${providerName}（${mode === "i2v" ? "图生视频" : "文生视频"}），jobId=${jobId}。\n这是异步任务，通常要几分钟 —— 你可以先做别的事，之后用 video_status 查进度（给这个 jobId）。` };
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
    const result = await pollVideoCore({ providerId, jobId });
    // ⛔ queued / running / pending 都算"还在跑" —— 只有终态才往下走（源里状态枚举比 pending 多）
    if (result.status !== "succeeded" && result.status !== "failed") {
      return { ok: true, output: `任务 ${jobId} 还在生成中（${providerId}）—— 过一会儿再查一次。` };
    }
    if (result.status === "failed") {
      updateVideoJob(jobId, { status: "failed", error: result.error });
      return { ok: false, error: `生成失败：${result.error ?? "厂商未给原因"}` };
    }
    const url = String(result.url || "");
    const workspace = String(args.workspace || job?.workspace || threadCwd.get(callerThreadId) || "").trim();
    if (url && workspace) {
      try {
        const name = String(args.name || job?.name || `video-${jobId.slice(0, 8)}.mp4`);
        const saved = await downloadVideoCore({ url, workspace, name });
        updateVideoJob(jobId, { status: "succeeded", url, path: saved.path });
        return { ok: true, output: `已生成并落盘：${saved.path}（${(saved.bytes / 1048576).toFixed(1)} MB）` };
      } catch (error) {
        updateVideoJob(jobId, { status: "succeeded", url });
        return { ok: true, output: `视频已生成，但下载落盘失败（${(error as Error)?.message ?? error}）。原始地址：${url}` };
      }
    }
    updateVideoJob(jobId, { status: "succeeded", url });
    return { ok: true, output: `视频已生成：${url}${workspace ? "" : "（没有工作目录，未落盘；把工作目录给我可以再下载）"}` };
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
