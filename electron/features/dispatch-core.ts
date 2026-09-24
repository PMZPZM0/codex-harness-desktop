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
