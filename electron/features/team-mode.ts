/**
 * team-mode（域，10-24）—— **团队工作模式**：一次点击把「团队记忆 + 团队知识库」接到本机。
 *
 * ── 为什么是"模式切换"，不是"新工具" ───────────────────────────────────
 * 10-16 实测（见 `cloud-memory-ipc.ts` 头注释）：记忆中枢 `memapi` **没有任何记忆读写路由**，
 * 记忆由对话上游（tdai-proxy）在请求层自动注入 / 自动写入，按 `userKey` 隔离命名空间。
 * ⇒ 团队记忆的正确接法 = 把**对话上游**切到「团队 userKey 的记忆端点」，而不是造 write/search 工具。
 * ⇒ 团队知识库则相反：WeKnora 有真 MCP 端点，接成连接器即可（模型侧直接有 search_knowledge）。
 *
 * 于是本域做两件事（互不依赖，各自可单独就绪）：
 *   ① memory：`setMemoryUpstream({ baseUrl, encryptedUserKey: 团队 key })` → `resyncCloudUpstream()`
 *   ② kb：`syncCloudMcpConnector({ id: "cloud-kb-team", url: mcpUrl, token })`，并**停用个人 `cloud-kb`**
 *      （两个 WeKnora 连接器的工具名相同，同时启用会撞名 ⇒ 一次只留一个）
 *
 * ⛔⛔ **记忆通道是独占的**：进入团队模式 = 个人记忆暂时让位（同一个 `memory-upstream.json`）。
 *   退出时按 `prevKbEnabled` 恢复个人知识库连接器，并把记忆上游清回纯模型
 *   （用户可在云账号页再点一次「同步记忆」恢复个人记忆）。
 * ⛔ 落盘只经 `cloud-provider` 的单一决策点，本域只写"意图"，⛔ 不自己写 config.toml / 供应商行。
 * ⛔ 令牌一律 `encrypt()` 后落盘；safeStorage 不可用时宁可失败，也不写明文。
 */
import fs from "node:fs";
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { cloudFetch, cloudHome, encrypt, fetchIntegrations } from "../cloud-api";
import { readCloudMcpConnector, syncCloudMcpConnector } from "../cloud-mcp";
import { readMemoryUpstream, resyncCloudUpstream, setMemoryUpstream } from "../cloud-provider";
import { refreshEngineInstructions } from "../backend-routing";
import { notifyMemoryBackendChanged } from "./memory-backend-events";

const CHANNELS = ["team:list", "team:enter", "team:exit", "team:status", "team:upload"];

/** 团队知识库连接器 id（与个人 `cloud-kb` 分开，避免互相覆盖）。 */
export const CLOUD_KB_TEAM_CONNECTOR_ID = "cloud-kb-team";
const CLOUD_KB_PERSONAL_CONNECTOR_ID = "cloud-kb";
const TEAM_KB_SECRET_ENV = "CLOUD_KB_TEAM_TOKEN";

type TeamBrief = {
  id: string;
  name: string;
  role: string;
  seats: { used: number; limit: number };
  memoryEnabled: boolean;
  kbEnabled: boolean;
  createdAt?: number;
};

type TeamContext = {
  teamId: string;
  name: string;
  role: string;
  enteredAt: number;
  /** 进入前个人知识库连接器是否启用（退出时按原样恢复）。 */
  prevKbEnabled: boolean;
};

type IntegrationsReply = {
  ok?: boolean;
  role?: string;
  knowledge?: { ready?: boolean; kbId?: string; mcpUrl?: string; mcpToken?: string };
  memory?: { ready?: boolean; baseUrl?: string; userKey?: string; apiKeyHeader?: string };
  error?: string;
  message?: string;
};

function contextFile(): string {
  return path.join(cloudHome(), "team-context.json");
}

function readContext(): TeamContext | null {
  try {
    const raw = JSON.parse(fs.readFileSync(contextFile(), "utf8")) as TeamContext;
    return raw && raw.teamId ? raw : null;
  } catch {
    return null;
  }
}

function writeContext(ctx: TeamContext): void {
  const dir = cloudHome();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(contextFile(), JSON.stringify(ctx, null, 2), { mode: 0o600 });
}

function clearContext(): void {
  try {
    fs.rmSync(contextFile(), { force: true });
  } catch {
    /* 删不掉也不影响下次覆盖写 */
  }
}

/** 生效状态：记忆是否真的走团队端点、团队库连接器是否启用。 */
async function statusNow() {
  const ctx = readContext();
  const upstream = await readMemoryUpstream();
  const teamKb = await readCloudMcpConnector(CLOUD_KB_TEAM_CONNECTOR_ID);
  const personalKb = await readCloudMcpConnector(CLOUD_KB_PERSONAL_CONNECTOR_ID);
  return {
    active: Boolean(ctx),
    team: ctx ? { id: ctx.teamId, name: ctx.name, role: ctx.role, enteredAt: ctx.enteredAt } : null,
    memory: {
      /* ⛔ 这里只能报"有没有记忆上游"，无法从文件反推它属于哪个团队 ——
         所以以 context 为准：有 context 且上游存在 = 团队记忆生效。 */
      on: Boolean(upstream),
      scope: ctx && upstream ? "team" : upstream ? "personal" : "model",
    },
    kb: {
      teamConnector: teamKb.enabled,
      personalConnector: personalKb.enabled,
      url: teamKb.url || "",
    },
  };
}

async function settle(): Promise<void> {
  notifyMemoryBackendChanged();
  await refreshEngineInstructions();
}

export const teamModeFeature = defineFeature<null>({
  id: "team",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("team-mode: 缺少 ipc 服务（宿主未提供）");
    void CHANNELS;

    /* 我加入的团队（服务端已按成员身份过滤，非成员拿不到）。 */
    ipcHost.handle("team:list", async () => {
      const res = await cloudFetch<{ ok: boolean; teams: TeamBrief[]; policy?: { enabled?: boolean } }>("/teams");
      if (!res.ok) return { ok: false, error: res.error || "teams-failed", teams: [] as TeamBrief[] };
      const teams = (res.data?.teams ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        role: t.role,
        seats: t.seats ?? { used: 0, limit: 0 },
        memoryEnabled: Boolean(t.memoryEnabled),
        kbEnabled: Boolean(t.kbEnabled),
        createdAt: t.createdAt,
      }));
      return { ok: true, teams, policyEnabled: res.data?.policy?.enabled !== false };
    });

    /* 进入团队模式：拉团队凭据 → 切记忆上游 + 接团队库连接器。 */
    ipcHost.handle("team:enter", async (_event: unknown, input?: { teamId?: string }) => {
      const teamId = String(input?.teamId ?? "").trim();
      if (!teamId) return { ok: false, error: "missing-team-id" };

      const res = await cloudFetch<IntegrationsReply>(`/teams/${encodeURIComponent(teamId)}/integrations`);
      if (!res.ok) {
        return { ok: false, error: res.error === "not-a-member" ? "not-a-member" : res.error || "integrations-failed" };
      }
      const integ = res.data ?? {};
      const mem = integ.memory ?? {};
      const kb = integ.knowledge ?? {};

      /* ① 记忆：切到团队端点。⛔ 加密失败就整体失败 —— 宁可不进模式，也不写明文 key。 */
      if (mem.ready && mem.baseUrl && mem.userKey) {
        const encryptedUserKey = encrypt(String(mem.userKey));
        if (!encryptedUserKey) return { ok: false, error: "safe-storage-unavailable" };
        await setMemoryUpstream({ baseUrl: String(mem.baseUrl), encryptedUserKey });
      } else {
        await setMemoryUpstream(null);
      }

      /* ② 知识库：先停个人（工具名会撞），再接团队。 */
      const prevKb = await readCloudMcpConnector(CLOUD_KB_PERSONAL_CONNECTOR_ID);
      if (kb.ready && kb.mcpUrl) {
        if (prevKb.enabled) await syncCloudMcpConnector(null, CLOUD_KB_PERSONAL_CONNECTOR_ID);
        await syncCloudMcpConnector(
          {
            id: CLOUD_KB_TEAM_CONNECTOR_ID,
            name: "知识库（团队）",
            url: String(kb.mcpUrl),
            token: String(kb.mcpToken || ""),
            secretKey: TEAM_KB_SECRET_ENV,
          },
          CLOUD_KB_TEAM_CONNECTOR_ID,
        );
      } else {
        /* 团队库没开通：不伪造一个空连接器，只把状态如实报回去。 */
        await syncCloudMcpConnector(null, CLOUD_KB_TEAM_CONNECTOR_ID);
      }

      const applied = await resyncCloudUpstream();
      const teamName = String((res.data as { name?: string } | null)?.name || teamId);
      writeContext({
        teamId,
        name: teamName,
        role: String(integ.role || ""),
        enteredAt: Date.now(),
        prevKbEnabled: prevKb.enabled,
      });
      await settle();

      return {
        ok: true,
        team: { id: teamId, name: teamName },
        memory: { ready: Boolean(mem.ready && applied.memory), upstreamChanged: applied.changed },
        kb: { ready: Boolean(kb.ready), url: kb.mcpUrl || "" },
        /* 缺什么就说什么 —— 界面直接展示，不让用户猜"为什么没生效"。 */
        missing: [
          mem.ready ? "" : "团队记忆空间未开通（owner 在网页端点「开通 / 修复团队空间」）",
          kb.ready ? "" : "团队知识库未开通",
        ].filter(Boolean),
      };
    });

    /* 退出：清团队记忆上游 + 停团队库连接器，按原样恢复个人知识库。 */
    ipcHost.handle("team:exit", async () => {
      const ctx = readContext();
      await setMemoryUpstream(null);
      await syncCloudMcpConnector(null, CLOUD_KB_TEAM_CONNECTOR_ID);

      /* 个人知识库原先是开的 ⇒ 用个人 integrations 重建一次（令牌不缓存，只从服务端取）。 */
      if (ctx?.prevKbEnabled) {
        const res = await fetchIntegrations();
        const kb = res.data?.knowledge ?? {};
        if (res.ok && kb.mcpUrl) {
          await syncCloudMcpConnector({
            id: CLOUD_KB_PERSONAL_CONNECTOR_ID,
            name: "知识库（云端）",
            url: String(kb.mcpUrl),
            token: String(kb.mcpToken || ""),
            secretKey: "CLOUD_KB_MCP_TOKEN",
          }, CLOUD_KB_PERSONAL_CONNECTOR_ID);
        }
      }

      await resyncCloudUpstream();
      clearContext();
      await settle();
      return { ok: true, note: "已退出团队模式：记忆回到纯模型端点，个人知识库按原状态恢复（个人记忆需在云账号页再同步一次）" };
    });

    /* 团队库上传（10-24）：选中本机文件 → base64 → 云端 `/teams/:id/kb/upload`。
       ⛔ 必须走云端（不直连 WeKnora）：容量闸 / 积分闸 / 过期只读 / 「仅 owner 可上传」都在服务端，
          绕过它就等于绕开计费与权限。 */
    ipcHost.handle("team:upload", async (_event: unknown, input?: { paths?: string[] }) => {
      const ctx = readContext();
      if (!ctx) return { ok: false, error: "not-in-team", results: [] };
      const paths = (input?.paths || []).filter((x) => typeof x === "string" && x.trim()).slice(0, 10);
      if (!paths.length) return { ok: false, error: "no-file", results: [] };
      const results: Array<{ name: string; ok: boolean; error?: string; message?: string; cost?: number; usedMb?: number; quotaMb?: number }> = [];
      for (const file of paths) {
        const name = path.basename(file);
        try {
          const buf = fs.readFileSync(file);
          if (!buf.length) { results.push({ name, ok: false, error: "empty-file" }); continue; }
          if (buf.length > 24 * 1024 * 1024) { results.push({ name, ok: false, error: "too-large", message: "单文件上限 24MB" }); continue; }
          const res = await cloudFetch<{ ok?: boolean; error?: string; message?: string; cost?: number; usedMb?: number; quotaMb?: number }>(
            `/teams/${encodeURIComponent(ctx.teamId)}/kb/upload`,
            { method: "POST", body: { name, contentB64: buf.toString("base64") }, timeoutMs: 120_000 },
          );
          const d = res.data ?? {};
          results.push({
            name,
            ok: res.ok && d.ok !== false,
            error: d.error || (res.ok ? undefined : res.error),
            message: d.message,
            cost: d.cost,
            usedMb: d.usedMb,
            quotaMb: d.quotaMb,
          });
        } catch (e) {
          results.push({ name, ok: false, error: String((e as Error)?.message || e).slice(0, 120) });
        }
      }
      return { ok: results.some((r) => r.ok), results };
    });

    ipcHost.handle("team:status", async () => {
      const st = await statusNow();
      return { ok: true, ...st };
    });
  },
});
