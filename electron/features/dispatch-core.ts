/**
 * dispatch-core（09-22 架构改造：从 electron/main.ts 组合根按域拆出，纯搬迁）
 *
 * 域：调度能力的**常驻核心** —— 令牌持久化、内置调度 MCP 服务器的工具面（schema）、
 *     可调度对象目录（专家 / 专家团 / 子智能体）、以及「不允许开调度」的会话识别。
 * 搬出符号：restrictedThreadRole / DISPATCH_FIXED_PORT / dispatchToken / dispatchHttpPort /
 *           DispatchProbe / dispatchProbes / ensureDispatchToken / stableKey / dispatchMcpTools /
 *           dispatchHttpReady / buildDispatchCatalog。
 * 与 ./dispatch.ts（纯策略：canDispatchFrom / admitDispatch / 文案）和 ./features/dispatch-rpc.ts
 * （HTTP 端点 + RPC 执行入口）的分工：本模块只提供**元数据与状态**，不含执行链路。
 * 消费方：main.ts（bindBoot 注入 + mutableState）、features/dispatch-rpc.ts、features/delegation.ts、
 *         features/engine-ipc.ts、features/teams-agents-ipc.ts、features/custom-model-apply.ts。
 *
 * 代码与原地逐字一致（仅顶部 import、文件头注释、末尾 setter 与 export 清单）。
 * 跨域符号经 `import … from "../main"` 取用 —— **活绑定**（TS→CJS 编译成 `main_1.X` 属性访问）。
 * ⛔ dispatchHttpPort / dispatchHttpReady 是 let 且被 features/dispatch-rpc.ts 经 mutableState 赋值
 *   ⇒ 本模块暴露 setter（ESM 里 import 的绑定不可赋值，TS2632）。
 */
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { readExpertTeams } from "../expert-teams";
import type { DispatchTarget } from "../dispatch";
import { readSubAgents } from "../main/09-agents-plugins";
import { delegateRegistry, teamRunStore } from "../runtime-refs";
// ── 调度（09-15）：让 Codex 在任意会话里调度 专家 / 专家团 / 子智能体 干活 ─────────────
// 四层防护里主进程负责的部分：L3 执行侧硬闸、L4 并发/深度闸、L1 持久指令。
// L2（注册侧不给工具）在渲染层，但那一层防不住「线程复用 / 竞态 / 以后有人改错注册点」——
// 所以真正的安全边界是下面这行 canDispatchFrom：**给了工具也不认**。

/** 「不允许开调度」的会话识别（09-16 用户要求：专家会话 / 专家团会话也要禁用掉）。
 *  覆盖三类：① 被调度产生的临时会话（delegateRegistry）② 专家团会话（主理人 + 成员）
 *  ③ 单人专家的直达会话 —— ③ 走的是同一条 member-session 链路（单人专家 = 只有 lead 的团队），
 *  所以 teamRunStore 里的 thread→team 映射一并覆盖。 */
async function restrictedThreadRole(threadId: string): Promise<{ restricted: boolean; label?: string }> {
  if (!threadId) return { restricted: false };
  if (await delegateRegistry.infoOf(threadId)) return { restricted: true, label: "被调度的临时会话" };
  if (teamRunStore.teamOfThread(threadId)) return { restricted: true, label: "专家 / 专家团" };
  return { restricted: false };
}

// ⛔ 09-16 重大修正（引擎硬约束，四个决定性实验实测）：dynamicTools **只在 thread/start 生效**——
// resume / fork / turn/start / queue/start 一律不认（引擎二进制里也只有 thread/start.dynamicTools）。
// 这意味着渲染层 dynamicTools 注册的 agent_invoke 对**老会话永远不可见**，之前「开关确认后重放
// resume」的修法是假绿（断言正则匹配到了提问里的「有没有」）。唯一能覆盖所有会话（含老会话）的
// 通道是 **MCP**：引擎级注入，工具对所有线程可见。故 agent_invoke 改走内置 MCP 服务器（下方
// dispatchMcpScript），安全闸全部收敛到主进程 HTTP 端 + 引擎事件旁证（谁调的、有没有权限）。

/** 内置调度 MCP 服务器（HTTP 直连）。⛔ 端口必须**固定**、令牌必须**持久化**：
 *  config.toml 里的 url 是引擎启动时读的，若每次运行都变（随机端口/随机令牌），
 *  引擎就会连到**上一次运行的死端口** → 工具永远注册不上（09-16 实测踩坑）。 */
const DISPATCH_FIXED_PORT = 47120;
let dispatchToken = ""; // 由 ensureDispatchToken() 从文件读/生成
let dispatchHttpPort = DISPATCH_FIXED_PORT;
type DispatchProbe = { threadId: string; argsKey: string; at: number };
const dispatchProbes: DispatchProbe[] = [];

/** 读取（或首次生成并持久化）调度令牌：跨运行稳定，config.toml 无需每次重写。 */
async function ensureDispatchToken(): Promise<string> {
  if (dispatchToken) return dispatchToken;
  const file = path.join(app.getPath("userData"), "dispatch-token.txt");
  try {
    const saved = (await fs.readFile(file, "utf8")).trim();
    if (saved.length >= 16) { dispatchToken = saved; return dispatchToken; }
  } catch { /* 首次运行没有文件 */ }
  dispatchToken = crypto.randomUUID().replace(/-/g, "");
  try { await fs.writeFile(file, dispatchToken, "utf8"); } catch { /* 写失败不致命：本次会话仍可用 */ }
  return dispatchToken;
}

/** 稳定序列化（键排序）：把「item/started 事件里的 arguments」与「MCP 服务器收到的 arguments」对上号 */
function stableKey(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      return Object.keys(obj).sort().map((k) => `${k}:${JSON.stringify(walk(obj[k]))}`).join("|");
    }
    return String(JSON.stringify(v) ?? "null");
  };
  return String(walk(value)).slice(0, 4000);
}

/** 调度工具的 schema（MCP tools/list 与 stdio 通道共用）。 */
function dispatchMcpTools(): unknown[] {
  return [
    {
      name: "agent_invoke",
      description: "调度专家 / 专家团 / 子智能体 执行一个独立子任务并拿回产出（仅在会话开启调度时可用）。",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["expert", "team", "member", "subagent"], description: "expert=单个专家, team=专家团(主理人按SOP调度), member=专家团某成员, subagent=子智能体" },
          name: { type: "string", description: "对象名称（专家名 / 团名 / 子智能体名）" },
          member: { type: "string", description: "kind=member 时的成员名" },
          query: { type: "string", description: "交给它的任务描述（要自包含：对方看不到本会话上下文）" },
        },
        required: ["kind", "name", "query"],
      },
    },
    {
      name: "agent_archive_sessions",
      description: "征得用户同意后，归档本次调度产生的临时会话。",
      inputSchema: {
        type: "object",
        properties: { threadIds: { type: "array", items: { type: "string" }, description: "要归档的调度会话 id 列表" } },
        required: ["threadIds"],
      },
    },
    /* ── 定时任务四件套（09-28 用户要求「直接调用定时任务工具」）─────────────────────
       用户在会话里说「每天早上给我 AI 早报」⇒ 模型直接建任务，不用去界面点。
       执行端在 dispatch-rpc.ts：scheduler_save 走 restrictedThreadRole 同源闸
       （专家 / 被调度会话不许建 —— 防套娃：专家安排任务、任务再调专家）。
       ⚠️ 设计变更：此前模型侧没有 scheduler 工具（【196】原负向断言）——放开后
       该断言已改为「必须含四件套」，且 harness-api 的调用面说明已同步。 */
    {
      name: "scheduler_save",
      description: "创建或更新一个定时任务：到点后在指定工作区自动执行提示词（一次性或周期）。可选在已有会话里续聊执行，可选把回合结论推送到微信。不确定用户要在哪个会话执行时，先问用户再建。",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "任务名（如「AI 新闻早报」）" },
          prompt: { type: "string", description: "到点执行的提示词（必须自包含：定时任务看不到本会话的任何上下文）" },
          workspace: { type: "string", description: "工作目录；缺省 = 当前会话的工作目录" },
          threadId: { type: "string", description: "执行所在的会话：\"current\" = 就在当前这个对话里续聊执行（最常用）；或传具体会话 id；**缺省 = 新建会话**。用户说「就在这个对话里…」必须传 \"current\"；不确定用户要哪个会话就先问" },
          scheduleType: { type: "string", enum: ["once", "recurring"], description: "once=只跑一次；recurring=周期" },
          scheduledAt: { type: "string", description: "once 必填：执行时刻（ISO 8601 带时区，如 2026-09-29T09:00:00+08:00）" },
          rrule: { type: "string", description: "recurring 必填：RRULE（如 FREQ=DAILY;BYHOUR=9;BYMINUTE=0）" },
          model: { type: "string", description: "可选：指定模型档位" },
          deliverWeixin: { type: "boolean", description: "执行完成后把回合结论推送给微信用户（需已绑定机器人）" },
          deliverTo: { type: "string", description: "可选：微信收信人（wxid 或绑定昵称）；缺省 = 最近对话的用户。仅在 deliverWeixin=true 时有效" },
        },
        required: ["name", "prompt"],
      },
    },
    {
      name: "scheduler_list",
      description: "列出全部定时任务（名称 / 计划 / 下次运行时刻 / 上次错误）。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "scheduler_run",
      description: "立即手动运行一个定时任务（不等到点；任务的工作区会话里会出现真实回合）。",
      inputSchema: { type: "object", properties: { id: { type: "string", description: "任务 id（从 scheduler_list 拿）" } }, required: ["id"] },
    },
    {
      name: "scheduler_delete",
      description: "删除一个定时任务（不可恢复）。",
      inputSchema: { type: "object", properties: { id: { type: "string", description: "任务 id（从 scheduler_list 拿）" } }, required: ["id"] },
    },
    /* ── 媒体生成三件套（09-29 用户：「让 Codex 能够直接调用生图工作流与视频工作流」）────────
       为什么是「生图一件 + 视频两件」：生图是同步 HTTP（几十秒，模型等着就行）；
       视频是**异步任务**（提交后要跑几分钟）—— 如果让工具一直等，会卡死整个回合，
       所以拆成「提交（立刻拿 jobId）」+「查询（稍后问一次）」。jobId 由主进程落盘
       （userData/video-jobs.json），关掉画布 / 重启应用都不丢，模型随时能续查。
       ⛔ 与画布卡片共用同一套 core（video-gen.ts / builtin-images），不另写一份实现。 */
    {
      name: "image_generate",
      description: "用内置生图插件生成图片并落盘，返回本地文件路径（可直接用于回答里的引用、或作为视频首帧）。可一次生成多张（count）。用户说「画一张/生成图片/出图」时用这个，不要用脚本自己调 HTTP。",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "画面描述（主体 + 环境 + 光线 + 风格 + 质量词，越具体越好）" },
          count: { type: "number", description: "生成张数 1-4（默认 1）。多张会并发，适合同一提示词的多个变体" },
          model: { type: "string", description: "覆盖默认模型（一般不用填，留空走「设置 → 插件」里配的模型）" },
          workspace: { type: "string", description: "落盘到哪个工作目录的 .drama-canvas/assets/image（缺省 = 调用者会话的工作目录）" },
          name: { type: "string", description: "文件名前缀（缺省 img）" },
          size: { type: "string", description: "画幅尺寸，如 1024x1024 / 1024x1536（竖）/ 1536x1024（横）。⛔ 不给就走网关默认 —— 各家接受的值不同，报错就把这个参数去掉" },
          negative: { type: "string", description: "负面提示词（不想要什么：文字、畸形手指、水印…）。⛔ 不是每个网关都支持，无效时改用正面描述" },
        },
        required: ["prompt"],
      },
    },
    {
      name: "video_generate",
      description: "提交一个视频生成任务（异步），**立即**返回 jobId；随后用 video_status 查询进度。图生视频传 image（本地路径或公网 URL）。不要把本工具当同步接口反复等待 —— 提交完可以先做别的事，隔一会儿再查。",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "画面/运镜描述" },
          mode: { type: "string", enum: ["t2v", "i2v"], description: "t2v=文生视频（默认）；i2v=图生视频（要给 image）" },
          image: { type: "string", description: "i2v 的首帧：本地图片路径或公网 URL" },
          providerId: { type: "string", description: "厂商 id（缺省用第一个已配置凭证的厂商；id 见设置 → 插件 → 视频生成接口）" },
          model: { type: "string", description: "覆盖厂商默认模型" },
          duration: { type: "number", description: "时长（秒），缺省 5" },
          workspace: { type: "string", description: "产物落盘的工作目录（缺省 = 调用者会话的工作目录）" },
          name: { type: "string", description: "产物文件名（缺省 视频.mp4）" },
          aspect: { type: "string", enum: ["16:9", "9:16", "1:1"], description: "画幅。⚠️ 只有部分厂商支持指定（通义万相 / 即梦Seedance / Runway / Veo）；不支持的会明确报错并告诉你改用哪几家" },
        },
        required: ["prompt"],
      },
    },
    {
      name: "video_status",
      description: "查询 video_generate 提交的任务：pending（还在跑，稍后再查）/ succeeded（已好，会自动下载落盘并返回本地路径）/ failed（失败原因）。也可以不带参数查最近的任务列表。",
      inputSchema: {
        type: "object",
        properties: {
          jobId: { type: "string", description: "video_generate 返回的 jobId；不给则列出最近 10 个任务的状态" },
          providerId: { type: "string", description: "厂商 id（缺省用该任务提交时记下的厂商）" },
          workspace: { type: "string", description: "成功时下载到哪个工作目录（缺省用提交时记下的工作目录）" },
          name: { type: "string", description: "成功时产物的文件名" },
        },
      },
    },
    {
      name: "video_concat",
      description:
        "把多个视频片段合并成一条成片（整片导出）。内部用 ffmpeg：片段编码一致时**无损秒拼**，"
        + "不一致时自动统一画布尺寸与帧率重编码。顺序完全按传入的 files 顺序 —— 要成片顺序对，就自己排好。"
        + "产物落在 <workspace>/.drama-canvas/export/。需要 FFmpeg（设置 → 开发工具页可一键安装）。",
      inputSchema: {
        type: "object",
        properties: {
          files: {
            type: "array",
            items: { type: "string" },
            description: "要合并的片段路径列表，**按成片顺序**排列（通常是 video_status / image_generate 返回的本地 path）",
          },
          name: { type: "string", description: "成片文件名（默认「成片」，自动补 .mp4）" },
          workspace: { type: "string", description: "输出到哪个工作目录（缺省用调用者会话的工作目录）" },
          width: { type: "number", description: "需要重编码时的画布宽（默认 720）" },
          height: { type: "number", description: "需要重编码时的画布高（默认 1280，竖屏短剧）" },
          fps: { type: "number", description: "需要重编码时的帧率（默认 24）" },
        },
        required: ["files"],
      },
    },
  ];
}

/** 内置 MCP 的执行端：只在 127.0.0.1 监听，token 校验 + 「引擎事件里确实有这条调用」旁证。
 *  端口固定（DISPATCH_FIXED_PORT）→ config.toml 的 url 跨运行稳定，引擎重启也能连上。 */
let dispatchHttpReady: Promise<void> | null = null;



/** 组装「可调度对象目录」（只含已启用的；单人专家 = 只有 lead 的团队，结构同型） */
async function buildDispatchCatalog(): Promise<DispatchTarget[]> {  const [teams, subs] = await Promise.all([readExpertTeams(), readSubAgents()]);
  const targets: DispatchTarget[] = [];
  for (const team of teams) {
    if (!team.enabled) continue;
    if (!team.members?.length) {
      targets.push({
        kind: "expert",
        key: team.teamId,
        name: team.displayName.zh,
        profession: team.lead?.profession?.zh ?? "",
        description: team.lead?.description ?? team.description?.zh ?? "",
        teamId: team.teamId,
        memberId: team.lead?.id,
      });
    } else {
      targets.push({
        kind: "team",
        key: team.teamId,
        name: team.displayName.zh,
        profession: `${team.members.length} 位成员`,
        description: team.description?.zh ?? "",
        teamId: team.teamId,
      });
    }
  }
  for (const sub of subs) {
    if (!sub.enabled) continue;
    targets.push({ kind: "subagent", key: sub.id, name: sub.name, profession: "", description: sub.description ?? "" });
  }
  return targets;
}

/** ⛔ 被 features/dispatch-rpc.ts 经 main.mutableState 写入的两个 let（见文件头说明）。 */
export function setDispatchHttpPort(v: number): void { dispatchHttpPort = v; }
export function setDispatchHttpReady(v: Promise<void> | null): void { dispatchHttpReady = v; }

export {
  DISPATCH_FIXED_PORT, buildDispatchCatalog, dispatchHttpPort, dispatchHttpReady, dispatchMcpTools,
  dispatchProbes, dispatchToken, ensureDispatchToken, restrictedThreadRole, stableKey,
  type DispatchProbe,
};
