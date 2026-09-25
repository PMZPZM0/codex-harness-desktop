/**
 * 设置页 · memory（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 *
 * 09-25 新增「记忆后端」区块（`MemoryBackendSection`）—— 这不是搬迁，是本轮新加的功能：
 * 二选一（内置记忆金字塔 / MCP 记忆服务）。它自持状态，不占 App 的 props。
 */
import { useEffect, useState, type CSSProperties } from "react";
import { PageInfo } from "../../components/SettingsHead";
import { Archive, BookOpen, Cloud, LayoutGrid, Search } from "lucide-react";
import { MemoryConfigModal } from "../../features/memory";

export type MemoryCenterSectionProps = { memoryEnabled: any; setMemoryEnabled: any; setMemoryCenterTab: any; setMemoryCenterOpen: any; memories: any; memoryGroups: any; memoryLayers: any; memoryMode: any; workspaceMemoryEnabled: any; threads: any; scheduledTasks: any; localSkills: any; memoryStatus: any; memoryConfigOpen: any; memoryGateway: any; setMemoryGateway: any; memoryGatewayAction: any; setMemoryConfigOpen: any; testMemoryGateway: any; saveMemoryGateway: any };

/* ══ 记忆后端（09-25）════════════════════════════════════════════════════════
 * 二选一：内置记忆金字塔（默认）/ MCP 记忆服务（@vheins/local-memory-mcp）。
 * ⛔ 该服务**不内置**在安装包里（不进依赖、不随包发布）—— 用户明确要求「自主选择 + 命令安装」，
 *    所以这里**只展示安装命令 + 复制**，不做一键安装。
 * ⛔ 选了 MCP 但服务没装好时**不会丢记忆**：主进程 `effectiveMemoryBackend()` 会回退内置，
 *    并把原因经 `fallbackReason` 带回来显示（口径见 electron/memory-backend.ts，守卫【150】）。
 * ⛔ 状态每次挂载时读一次盘（readMemoryBackend 惰性求值），不在渲染层缓存真相。 */
type MemoryBackendStatus = {
  backend: "builtin" | "mcp";
  effective: "builtin" | "mcp";
  installed: boolean;
  serverPath: string;
  installRoot: string;
  installCommand: string;
  fallbackReason: string | null;
};

function MemoryBackendSection() {
  const [status, setStatus] = useState<MemoryBackendStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let alive = true;
    void window.codex
      .readMemoryBackend()
      .then((value) => {
        if (alive) setStatus(value as MemoryBackendStatus);
      })
      .catch(() => {
        if (alive) setStatus(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const pick = async (next: "builtin" | "mcp") => {
    setBusy(true);
    setNote("");
    try {
      const value = await window.codex.setMemoryBackend(next);
      setStatus(value as MemoryBackendStatus);
      setNote(next === "mcp" ? "已选 MCP 后端。服务装好后重启应用即可生效。" : "已切回内置记忆金字塔。");
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const copyCommand = async () => {
    if (!status) return;
    try {
      await navigator.clipboard.writeText(status.installCommand);
      setNote("安装命令已复制到剪贴板。");
    } catch {
      setNote("复制失败，请手动选中命令复制。");
    }
  };

  const radioRow: CSSProperties = { display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" };

  return (
    <>
      <div className="settings-copy channel-heading"><div><h2>记忆后端<PageInfo text={<>二选一：内置记忆金字塔，或可选的 MCP 记忆服务。两者**不会同时写入** —— 选了 MCP，内置金字塔就停止捕获，避免同一件事记两份。</>} /></h2></div></div>
      <p className="muted">MCP 记忆服务（@vheins/local-memory-mcp）<strong>不内置</strong>在安装包里，需要按下面的命令自行安装（装到 userData 下的独立目录，卸载就是删目录）。服务没装好时记忆不会被丢弃 —— 会自动回退到内置金字塔。</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
        <label style={radioRow}>
          <input type="radio" name="memoryBackend" checked={status?.backend === "builtin"} disabled={busy || !status} onChange={() => void pick("builtin")} />
          <span><strong>内置记忆金字塔</strong>（默认）<br /><small className="muted">L0~L7 分层 + 纠错/坑分类写入；自包含、零依赖。</small></span>
        </label>
        <label style={radioRow}>
          <input type="radio" name="memoryBackend" checked={status?.backend === "mcp"} disabled={busy || !status} onChange={() => void pick("mcp")} />
          <span><strong>MCP 记忆服务</strong><br /><small className="muted">{status?.installed ? "服务已安装。" : "服务未安装 —— 选中它会先回退到内置（不丢记忆）。"}</small></span>
        </label>
      </div>

      {status && (
        <p className="settings-status">当前生效：<strong>{status.effective === "mcp" ? "MCP 记忆服务" : "内置记忆金字塔"}</strong>{status.backend !== status.effective ? "（你选的是 MCP，但服务还没就绪）" : ""}</p>
      )}
      {status?.fallbackReason && <p className="settings-status">{status.fallbackReason}</p>}

      {status && !status.installed && (
        <>
          <p className="muted">安装命令（在终端执行）：</p>
          <p className="settings-status" style={{ fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>{status.installCommand}</p>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
            <button onClick={() => void copyCommand()}>复制安装命令</button>
            <span className="muted">装到：{status.installRoot}</span>
          </div>
        </>
      )}
      {note && <p className="settings-status">{note}</p>}
    </>
  );
}

export function MemoryCenterSection(props: MemoryCenterSectionProps) {
  const { memoryEnabled, setMemoryEnabled, setMemoryCenterTab, setMemoryCenterOpen, memories, memoryGroups, memoryLayers, memoryMode, workspaceMemoryEnabled, threads, scheduledTasks, localSkills, memoryStatus, memoryConfigOpen, memoryGateway, setMemoryGateway, memoryGatewayAction, setMemoryConfigOpen, testMemoryGateway, saveMemoryGateway } = props;
  return (
    <>
      <section className="settings-section stack memory-center">
                    <div className="settings-copy channel-heading"><div><h2>记忆<PageInfo text={<>记忆分「常驻记忆」与「记忆条目」两部分：常驻记忆每轮对话自动注入；条目按需召回，按重要度分 P0–P3 管理。</>} /></h2></div><label className="channel-enable"><input type="checkbox" checked={memoryEnabled} onChange={(event) => void setMemoryEnabled(event.target.checked)} /><span>{memoryEnabled ? "已启用" : "已停用"}</span></label></div>

                    <div className="memory-overview">
                      <button className="memory-overview-card" onClick={() => { setMemoryCenterTab("library"); setMemoryCenterOpen(true); }} title="浏览记忆条目">
                        <span className="memory-overview-top"><span className="memory-overview-icon"><Archive size={16} /></span>
                        <span className="memory-overview-body"><strong>记忆条目</strong><small>按重要度与来源会话整理，可逐条查看/置顶/删除</small></span></span>
                        <span className="memory-overview-stat"><b>{memories.length}</b> 条 · {memoryGroups.length} 个会话 · {memoryGroups.reduce((s: any, g: any) => s + g.items.filter((it: any) => (it as any).pinned).length, 0)} 置顶</span>
                      </button>
                      <button className="memory-overview-card" onClick={() => { setMemoryCenterTab("layers"); setMemoryCenterOpen(true); }} title="编辑常驻记忆">
                        <span className="memory-overview-top"><span className="memory-overview-icon"><BookOpen size={16} /></span>
                        <span className="memory-overview-body"><strong>常驻记忆</strong><small>用户档案 · 项目记忆 · 近期日志，每轮对话自动注入</small></span></span>
                        <span className="memory-overview-stat"><b>L0/L1/L2</b> 用户 {memoryLayers?.budget.user ?? 0} 字 · 背景 {memoryLayers?.budget.background ?? 0} 字 · 项目 {memoryLayers?.budget.project ?? 0} 字</span>
                      </button>
                      <button className="memory-overview-card" onClick={() => { setMemoryCenterTab("storage"); setMemoryCenterOpen(true); }} title="选择记忆保存位置">
                        <span className="memory-overview-top"><span className="memory-overview-icon"><Cloud size={16} /></span>
                        <span className="memory-overview-body"><strong>存储与同步</strong><small>记忆保存在本地或云端；工作区记忆跨会话复用</small></span></span>
                        <span className="memory-overview-stat"><b>{memoryMode === "cloud" ? "云端同步" : "本地"}</b>{workspaceMemoryEnabled ? " · 工作区已开启" : ""}</span>
                      </button>
                      <button className="memory-overview-card" onClick={() => { setMemoryCenterTab("search"); setMemoryCenterOpen(true); }} title="跨会话检索历史内容">
                        <span className="memory-overview-top"><span className="memory-overview-icon"><Search size={16} /></span>
                        <span className="memory-overview-body"><strong>全局搜索</strong><small>检索会话、记忆、任务与技能，命中按会话分组、可预览全文</small></span></span>
                        <span className="memory-overview-stat"><b>{threads.length}</b> 会话 · {scheduledTasks.length} 任务 · {localSkills.length} 技能</span>
                      </button>
                    </div>

                    <div className="memory-overview-actions">
                      <button className="primary-setting" onClick={() => { setMemoryCenterTab("library"); setMemoryCenterOpen(true); }}><LayoutGrid size={15} />打开记忆中心</button>
                      <span className="muted">浏览条目、编辑常驻记忆、切换存储都在记忆中心里完成，这里只做总览。</span>
                    </div>

                    {/* 被委派会话的记忆（09-23 加）：子智能体 / 专家 / 专家团主理人 / 成员的委派回合由**主进程**
                        直接 turn/start 发起（不经过渲染层的发送路径）⇒ 此前读不到任何记忆。现在按主会话同口径
                        注入常驻记忆 + 按本次任务召回；口径 / 门禁 / 三条硬约束见 electron/delegate-memory.ts
                        （守卫【125】）。 */}
                    <div className="settings-copy channel-heading"><div><h2>被委派会话的记忆<PageInfo text={<>子智能体 / 专家 / 专家团主理人 / 成员在被发起时，会拿到与主会话同样的常驻记忆（用户档案 · 项目记忆 · 纪律 · 近期日志），并按本次任务召回相关条目。工作区记忆关掉时只注入用户档案、不做召回。这条链路此前是缺的，09-23 补上。</>} /></h2></div></div>
                    <p className="muted">委派会话同样会写入记忆：回合结束时照常捕获进当日日志，检出纠错时另记一条坑。同一成员的成员会话会被复用，所以它自己也记得之前做过什么。</p>
                    {memoryStatus && <p className="settings-status">{memoryStatus}</p>}
                    {memoryConfigOpen && <MemoryConfigModal gateway={memoryGateway} setGateway={setMemoryGateway} action={memoryGatewayAction} onClose={() => setMemoryConfigOpen(false)} onTest={() => void testMemoryGateway()} onSave={() => void saveMemoryGateway()} />}

                    {/* 记忆后端（09-25 新增）：内置金字塔 ⇄ MCP 记忆服务二选一。 */}
                    <MemoryBackendSection />
                  </section>
    </>
  );
}
