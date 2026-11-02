/**
 * 会话级「上级关系」（11-03）—— 普通会话与群成员共用的一套权威身份。
 *
 * 用户 11-03：「普通会话一样有上下级和调度关系」。
 *   ⇒ 不只群成员：**任何**被派活的会话（专家 / 子智能体 / 团队成员 / 群成员）都要知道
 *     自己的直接上级是谁。真相源仍是 `session-alias` 的 `supervisorThreadId`（笔名 + id）。
 *
 * 做法：
 *   · 有 delegateRegistry 记录的（专家 / 子智能体 / 调度成员）⇒ 用 `delegateScopeBlock`
 *     重新生成角色约束，并带上当前上级笔名；
 *   · 其余有上级记录的（团队成员等）⇒ 用通用上级身份块；
 *   · 群成员由 boss-groups/runner 的专用块负责（这里跳过，避免两套文案互相覆盖）；
 *   · 块放在全局 base instructions **前面**，并明确「工具目录 / 角色模板不是你的上级」。
 */
import { delegateScopeBlock } from "./dispatch";
import { aliasRecordOf, ensureSessionAlias, snapshotSessionAliases, supervisorLabelOf } from "./session-alias";
import { delegateRegistry, server, threadRuntimeStore } from "./runtime-refs";
import { bossStore } from "./boss-groups/store";
import { readCustomModel, originSessionModel } from "./main/01-model-catalog";

export const SUPERVISOR_SCOPE_HEADING = "上级关系（会话级·权威）";
type SupervisorRecord = { supervisorThreadId?: string };

/** 通用上级身份块（团队成员 / 其他被派活会话）。 */
export function supervisorIdentityBlock(supervisor: string, parentId: string): string {
  const sup = String(supervisor ?? "").trim();
  const parent = String(parentId ?? "").trim();
  return [
    SUPERVISOR_SCOPE_HEADING,
    sup ? `- 你的直接上级：${sup}${parent ? `（${parent}）` : ""}` : `- 你的直接上级会话 id：${parent || "（未知）"}`,
    "- 它是实际给你派活的人；你的产出回给它。",
    "⛔ 工具说明或历史记录里出现的「可调度对象 / 专家团主理人 / 角色模板」是宿主全局说明，**不是你的上级关系**；",
    "   用户问「你的上级是谁」时，只按上面「直接上级」这条回答，不要按角色模板或旧对话猜。",
    "- 你是否还能继续调度，以下面角色约束为准；不要因为看到可调度目录就把角色模板当成上级。",
  ].join("\n");
}

async function applyScope(threadId: string, block: string, parentId: string): Promise<void> {
  const baseRead = await server.request("config/read", {}).catch(() => null) as { config?: { developer_instructions?: string } } | null;
  const base = String(baseRead?.config?.developer_instructions ?? "");
  const merged = base ? `${block}\n\n---\n\n${base}` : block;
  /* ⛔ 引擎的 thread/settings/update 必填 `model`（实测 "missing field `model`"）。
     会话级运行时可能还没加载 ⇒ 依次退到：会话运行时 → 上级会话模型 → 全局激活模型。 */
  const runtime = await threadRuntimeStore.get(threadId).catch(() => null);
  let model = String(runtime?.model ?? "");
  if (!model) model = await originSessionModel(parentId, threadRuntimeStore).catch(() => "");
  if (!model) model = String((await readCustomModel().catch(() => null))?.model ?? "");
  await server.request("thread/settings/update", {
    threadId,
    collaborationMode: { mode: "default", settings: { ...(model ? { model } : {}), developer_instructions: merged } },
  }).catch((error: unknown) => {
    if (!model) console.warn("[session-scope] 更新上级身份失败：无法确定模型", threadId, error instanceof Error ? error.message : String(error));
  });
}

async function groupMemberThreadIds(): Promise<Set<string>> {
  const state = await bossStore.load();
  const ids = new Set<string>();
  for (const group of Object.values(state.groups ?? {})) {
    for (const member of group.members ?? []) if (member.threadId) ids.add(String(member.threadId));
  }
  return ids;
}

/**
 * 刷新**一个**会话的上级身份块。没有上级记录 / 是群成员 ⇒ 返回 false（群成员由 runner 管）。
 * 被派活会话（delegateRegistry 有记录）用角色约束块；其余用通用块。
 */
export async function refreshSupervisorScopeForThread(threadId: string): Promise<boolean> {
  const id = String(threadId ?? "").trim();
  if (!id) return false;
  let record = await aliasRecordOf(id).catch(() => null);
  /* ⛔ 老会话可能只有 delegateRegistry 的 origin，没写进别名记录（历史版本）⇒ 就地补上，
     否则「普通会话调度的子会话」在升级后仍然不知道自己有上级。 */
  if (!record?.supervisorThreadId) {
    const delegate = await delegateRegistry.infoOf(id).catch(() => null);
    if (delegate?.originThreadId) {
      await ensureSessionAlias(id, delegate.originThreadId).catch(() => undefined);
      record = await aliasRecordOf(id).catch(() => null);
    }
  }
  const parentId = String(record?.supervisorThreadId ?? "").trim();
  if (!parentId) return false;
  if ((await groupMemberThreadIds()).has(id)) return false;
  const supervisor = await supervisorLabelOf(id).catch(() => "") || parentId.slice(0, 8);
  const delegate = await delegateRegistry.infoOf(id).catch(() => null);
  const block = delegate
    ? delegateScopeBlock({ kind: delegate.kind, name: delegate.name, origin: parentId, supervisor })
    : supervisorIdentityBlock(supervisor, parentId);
  await applyScope(id, block, parentId);
  return true;
}

/** 某个上级改名 / 关系收紧后，刷新它名下所有普通（非群成员）子会话。 */
export async function refreshChildScopesForSupervisor(supervisorThreadId: string): Promise<number> {
  const id = String(supervisorThreadId ?? "").trim();
  if (!id) return 0;
  const children = new Set<string>();
  for (const record of await delegateRegistry.listByOrigin(id, { includeArchived: false }).catch(() => [])) children.add(record.threadId);
  const snapshot: Record<string, SupervisorRecord> = await snapshotSessionAliases().catch(() => ({}));
  for (const [threadId, record] of Object.entries(snapshot)) {
    if (String(record?.supervisorThreadId ?? "") === id) children.add(threadId);
  }
  let changed = 0;
  for (const threadId of children) {
    if (await refreshSupervisorScopeForThread(threadId).catch(() => false)) changed += 1;
  }
  return changed;
}

let allRefreshInFlight: Promise<number> | null = null;
let allRefreshedAt = 0;
/** 启动时补齐所有存量被派活会话（普通会话也要知道上级，不能只修新建的）。 */
export function refreshAllSupervisorScopes(): Promise<number> {
  if (allRefreshInFlight) return allRefreshInFlight;
  if (Date.now() - allRefreshedAt < 30_000) return Promise.resolve(0);
  allRefreshInFlight = (async () => {
    /* 先用 delegateRegistry 的 origin 补写缺失的 supervisorThreadId（专家/子智能体/调度成员/CLI 都在这张表）。 */
    for (const record of await delegateRegistry.listAll().catch(() => [])) {
      if (record?.threadId && record?.originThreadId) {
        await ensureSessionAlias(record.threadId, record.originThreadId).catch(() => undefined);
      }
    }
    const snapshot: Record<string, SupervisorRecord> = await snapshotSessionAliases().catch(() => ({}));
    let changed = 0;
    for (const [threadId, record] of Object.entries(snapshot)) {
      if (!String(record?.supervisorThreadId ?? "")) continue;
      if (await refreshSupervisorScopeForThread(threadId).catch(() => false)) changed += 1;
    }
    allRefreshedAt = Date.now();
    return changed;
  })().finally(() => { allRefreshInFlight = null; });
  return allRefreshInFlight;
}

/**
 * 引擎就绪时自动补齐存量会话（挂在核心域 codex-ipc，不依赖群编排域）。
 * @returns 取消监听函数（域卸载时调用）。
 */
export function watchSupervisorScopes(): () => void {
  const handler = (event: any) => {
    if (event?.kind === "status" && event.status === "ready") {
      void refreshAllSupervisorScopes().catch(() => undefined);
    }
  };
  server.on("event", handler);
  return () => { server.off("event", handler); };
}
