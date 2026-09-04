import { useEffect, useState } from "react";

export type MemoryRecord = {
  id: string;
  category: string;
  content: string;
  sourceThreadId?: string;
  sourceTurnId?: string;
  confidence: number;
  updatedAt: number;
  pinned?: boolean;
  workspace?: string;
};

/** 漏斗优先级：核心分类与 pinned 决定保留价值 */
export type MemoryPriority = "P0" | "P1" | "P2" | "P3";

export function memoryPriorityOf(entry: { category: string; pinned?: boolean }): MemoryPriority {
  if (entry.pinned) return "P0";
  if (entry.category === "项目背景" || entry.category === "工作流/SOP") return "P1";
  if (entry.category === "任务经验") return "P2";
  return "P3"; // 临时上下文 / 其他
}

export const MEMORY_PRIORITY_ORDER: MemoryPriority[] = ["P0", "P1", "P2", "P3"];

/** 按会话聚合的「记忆组」 */
export type MemoryGroup = {
  key: string;                          // threadId 或 "__manual"
  threadId?: string;                    // 手动保存组无 threadId
  threadTitle: string;                  // 来自 threads lookup 或 fallback
  priority: "P0" | "P1" | "P2" | "P3";  // 组内最高优先级
  items: MemoryRecord[];
  latestAt: number;
  categories: string[];
};

export function groupMemoriesByThread(
  records: MemoryRecord[],
  threadTitleById: (threadId: string) => string | undefined,
): MemoryGroup[] {
  const map = new Map<string, MemoryGroup>();
  for (const entry of records) {
    const key = entry.sourceThreadId ?? "__manual";
    let group = map.get(key);
    if (!group) {
      const tid = entry.sourceThreadId;
      const tName = tid ? threadTitleById(tid) : undefined;
      group = {
        key,
        threadId: tid,
        threadTitle: tName ?? (tid ? `会话 ${tid.slice(0, 8)}` : "手动保存"),
        priority: memoryPriorityOf(entry),
        items: [],
        latestAt: 0,
        categories: [],
      };
      map.set(key, group);
    }
    group.items.push(entry);
    // 整组优先级取最高（P0 最小）
    const curRank = MEMORY_PRIORITY_ORDER.indexOf(group.priority);
    const newRank = MEMORY_PRIORITY_ORDER.indexOf(memoryPriorityOf(entry));
    if (newRank < curRank) group.priority = memoryPriorityOf(entry);
    if (entry.updatedAt > group.latestAt) group.latestAt = entry.updatedAt;
    if (!group.categories.includes(entry.category)) group.categories.push(entry.category);
  }
  // 按最新时间倒序；同级 pinned 优先
  return Array.from(map.values())
    .map((g) => ({ ...g, items: [...g.items].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt) }))
    .sort((a, b) => {
      if (a.priority !== b.priority) return MEMORY_PRIORITY_ORDER.indexOf(a.priority) - MEMORY_PRIORITY_ORDER.indexOf(b.priority);
      return b.latestAt - a.latestAt;
    });
}

export type MemoryGatewayState = {
  endpoint: string;
  sessionKey: string;
  userId: string;
  apiKey: string;
  hasApiKey: boolean;
};

export type MemoryMode = "local" | "cloud";

type Options = {
  threadId?: string;
  activeTurnId?: string | null;
};

const MODE_KEY = "memory-mode";
const WORKSPACE_KEY = "workspace-memory";

export function useMemory({ threadId, activeTurnId }: Options = {}) {
  const [memoryEnabled, setMemoryEnabledState] = useState(() => localStorage.getItem("memory-enabled") !== "false");
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [memoryCategory, setMemoryCategory] = useState(""); // 默认「全部」：自动捕获多落在项目背景等分类，默认选单一分类会显示空列表，被误认为记忆没生效
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memoryStatus, setMemoryStatus] = useState("");
  const [memoryGateway, setMemoryGateway] = useState<MemoryGatewayState>({ endpoint: "", sessionKey: "", userId: "codex-harness", apiKey: "", hasApiKey: false });
  const [memoryGatewayAction, setMemoryGatewayAction] = useState<"save" | "test" | null>(null);
  const [memoryMode, setMemoryModeState] = useState<MemoryMode>(() => {
    const stored = localStorage.getItem(MODE_KEY);
    return stored === "cloud" ? "cloud" : "local";
  });
  const [workspaceMemoryEnabled, setWorkspaceMemoryEnabled] = useState<boolean>(() => localStorage.getItem(WORKSPACE_KEY) === "true");

  useEffect(() => {
    void window.codex.listMemory().then((result) => setMemories(result ?? [])).catch(() => undefined);
  }, []);

  useEffect(() => {
    void window.codex.getMemoryGateway()
      .then((result) => setMemoryGateway({ endpoint: result.endpoint, sessionKey: result.sessionKey, userId: result.userId, apiKey: "", hasApiKey: result.hasApiKey }))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!threadId) return;
    void window.codex.request("thread/memoryMode/set", { threadId, mode: memoryEnabled ? "enabled" : "disabled" }).catch(() => undefined);
  }, [threadId]);

  // 模式以主进程为准（真正决定 recall/capture 去哪儿的是它），启动时对齐一次
  useEffect(() => {
    void window.codex.readMemoryMode().then((mode) => {
      setMemoryModeState(mode);
      localStorage.setItem(MODE_KEY, mode);
    }).catch(() => undefined);
  }, []);

  async function saveMemoryRecord() {
    if (!memoryDraft.trim()) return;
    try {
      const saved = await window.codex.saveMemory({ category: memoryCategory, content: memoryDraft, sourceThreadId: threadId, sourceTurnId: activeTurnId ?? undefined });
      setMemories((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)]);
      setMemoryDraft("");
      setMemoryStatus(`记忆已保存到「${memoryMode === "cloud" ? "云端" : "本地"}」`);
    } catch (error: any) {
      setMemoryStatus(error.message);
    }
  }

  async function deleteMemoryRecord(id: string) {
    await window.codex.deleteMemory(id);
    setMemories((current) => current.filter((entry) => entry.id !== id));
  }

  /** 按会话组一次性删除：避免一次会话产生的多条 message-level 记录要逐条删 */
  async function deleteMemoryGroup(predicate: (entry: MemoryRecord) => boolean) {
    const targets = memories.filter(predicate);
    if (!targets.length) return 0;
    await Promise.all(targets.map((entry) => window.codex.deleteMemory(entry.id).catch(() => undefined)));
    setMemories((current) => current.filter((entry) => !predicate(entry)));
    return targets.length;
  }

  async function resetMemory() {
    await window.codex.resetMemory();
    setMemories([]);
  }

  async function testMemoryGateway() {
    setMemoryGatewayAction("test");
    try {
      const result = await window.codex.testMemoryGateway(memoryGateway);
      setMemoryStatus(`Memory Gateway 可用 · ${result.latencyMs} ms`);
    } catch (error: any) {
      setMemoryStatus(`Gateway 连接失败：${error.message}`);
    } finally {
      setMemoryGatewayAction(null);
    }
  }

  async function saveMemoryGateway() {
    setMemoryGatewayAction("save");
    try {
      const saved = await window.codex.saveMemoryGateway(memoryGateway);
      setMemoryGateway({ ...memoryGateway, apiKey: "", hasApiKey: saved.hasApiKey });
      setMemoryStatus(saved.configured ? "Memory Gateway 已启用" : "已切换到本地记忆");
    } catch (error: any) {
      setMemoryStatus(`Gateway 保存失败：${error.message}`);
    } finally {
      setMemoryGatewayAction(null);
    }
  }

  async function setMemoryEnabled(enabled: boolean) {
    setMemoryEnabledState(enabled);
    localStorage.setItem("memory-enabled", String(enabled));
    if (!threadId) return;
    try {
      await window.codex.request("thread/memoryMode/set", { threadId, mode: enabled ? "enabled" : "disabled" });
    } catch (error: any) {
      setMemoryStatus(`同步 Codex 记忆模式失败：${error.message}`);
    }
  }

  async function updateMemoryMode(mode: MemoryMode) {
    const previous = memoryMode;
    setMemoryModeState(mode);
    localStorage.setItem(MODE_KEY, mode);
    try {
      const applied = await window.codex.setMemoryMode(mode);
      setMemoryModeState(applied);
      localStorage.setItem(MODE_KEY, applied);
      setMemoryStatus(applied === "cloud" ? "已切换到云端记忆 · codex 会去云端查找与保存" : "已切换到本地记忆 · 仅保存在本机 memory.json");
    } catch (error: any) {
      setMemoryModeState(previous);
      localStorage.setItem(MODE_KEY, previous);
      setMemoryStatus(`切换记忆来源失败：${error.message}`);
    }
  }

  function updateWorkspaceMemory(enabled: boolean) {
    setWorkspaceMemoryEnabled(enabled);
    localStorage.setItem(WORKSPACE_KEY, String(enabled));
    setMemoryStatus(enabled ? "工作区记忆已开启：新会话生效，可能增加模型调用与 Token 成本" : "工作区记忆已关闭");
  }

  return {
    memoryEnabled,
    memories,
    setMemories,
    memoryCategory,
    setMemoryCategory,
    memoryDraft,
    setMemoryDraft,
    memoryStatus,
    setMemoryStatus,
    memoryGateway,
    setMemoryGateway,
    memoryGatewayAction,
    memoryMode,
    updateMemoryMode,
    workspaceMemoryEnabled,
    updateWorkspaceMemory,
    saveMemoryRecord,
    deleteMemoryRecord,
    deleteMemoryGroup,
    resetMemory,
    testMemoryGateway,
    saveMemoryGateway,
    setMemoryEnabled,
  };
}
