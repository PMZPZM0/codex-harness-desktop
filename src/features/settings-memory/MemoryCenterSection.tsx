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
import { SettingsDialog } from "../../components/SettingsDialog";
import { PageInfo } from "../../components/SettingsHead";
import { Archive, BookOpen, Bot, Cloud, Database, LayoutGrid, Search, Server } from "lucide-react";
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
  const [busyLabel, setBusyLabel] = useState("");
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
      const status = value as MemoryBackendStatus;
      setStatus(status);
      /* ⛔ 文案必须说清「什么时候生效」（09-25 用户实测困惑：切了后端但技能清单还是旧的）。
         事实：切换会**当场**同步技能文件与连接器；但引擎侧（config.toml 的指令与 MCP 服务注册）
         由启动自愈在下次启动时重写 ⇒ 要重启应用；模型实际改口径还要**新开会话**（引擎把指令
         钉在会话上，已在跑的会话读的是旧的那份）。
         ⛔ 选了 MCP 但服务没装好时 effective 仍是 builtin ⇒ **不能说"已切到 MCP"**（那是假话，
            技能也仍保持 memory-classify）——退回内置口径的说明，并指向上面的回退原因。 */
      const notEffective = next === "mcp" && status.effective !== "mcp";
      setNote(next !== "mcp"
        ? "已切回内置记忆金字塔，技能与连接器已同步落盘。重启应用后引擎侧生效。"
        : notEffective
          ? "已记下选择，但 MCP 服务尚未装好 ⇒ 当前仍走内置金字塔（技能保持 memory-classify）。先装服务，重启应用后才会真正切过去。"
          : "已切到 MCP 记忆后端，技能与连接器已同步落盘。重启应用后引擎侧生效；之后新开一个会话，模型就会按 MCP 写法记记忆（不再往 lessons/ 手写）。");
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
      setNote("安装命令已复制到剪贴板（想自己装时用）。");
    } catch {
      setNote("复制失败，请手动选中命令复制。");
    }
  };

  /* 一键安装 / 卸载 / 检测（09-25 用户要求「加个安装功能」）。
     主进程用**应用自带的 node** 跑安装器 —— 新电脑不用预装 Node.js，装与跑同 ABI。
     ⛔ 首次安装要下依赖 + 原生绑定，可能几分钟 ⇒ busyLabel 让用户知道在动、不是卡了。 */
  const runAction = async (kind: "install" | "uninstall" | "verify") => {
    setBusy(true);
    setNote("");
    setBusyLabel(kind === "install" ? "正在安装…（默认走国内镜像；首次几分钟：下载依赖 + 原生绑定）" : kind === "uninstall" ? "正在卸载…" : "正在检测…");
    try {
      const r = kind === "install"
        ? await window.codex.installMemoryMcp()
        : kind === "uninstall"
          ? await window.codex.uninstallMemoryMcp()
          : await window.codex.verifyMemoryMcp();
      if (r?.status) setStatus(r.status as MemoryBackendStatus);
      if (kind === "uninstall") {
        setNote("已卸载：记忆服务目录已删除。");
      } else if (r?.result?.verified) {
        // 把实际用到的镜像显示出来（安装器默认 npmmirror，失败才依次换源）
        const via = typeof r?.result?.registry === "string" ? `（源：${r.result.registry.replace(/^https?:\/\//, "")}）` : "";
        setNote(kind === "install" ? `安装完成，MCP 握手已通过 ✅ ${via}`.trim() : "检测通过：服务能正常握手 ✅");
      } else {
        const why = r?.result?.error ?? r?.log?.split("\n").filter(Boolean).pop() ?? "未知原因";
        setNote(`失败：${why}`);
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };

  const radioRow: CSSProperties = { display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" };
  void radioRow; // 09-25 排版返工后 radioRow 已不再使用；保留 void 防止 lint 报未用（后续清理时一并删）

  return (
    <>
      <div className="settings-copy channel-heading"><div><h2>记忆后端<PageInfo text={<>二选一：内置记忆金字塔，或可选的 MCP 记忆服务。两者**不会同时写入** —— 选了 MCP，内置金字塔就停止捕获，避免同一件事记两份。</>} /></h2></div></div>
      <p className="muted">MCP 记忆服务（@vheins/local-memory-mcp）<strong>不内置</strong>在安装包里，需要按下面的按钮或命令安装（装到 userData 下的独立目录，卸载就是删目录）。服务没装好时记忆不会被丢弃 —— 会自动回退到内置金字塔。</p>

      {/* 09-25 排版返工：原生 radio ⇒ 可点击选择卡片（选中态绿框 + 浅绿底 + 右上角勾） */}
      <div className="memory-backend-options" role="radiogroup" aria-label="记忆后端">
        <button type="button" role="radio" aria-checked={status?.backend === "builtin"} className="memory-backend-option" disabled={busy || !status} onClick={() => void pick("builtin")}>
          <span className="memory-backend-icon"><Database size={16} /></span>
          <span className="memory-backend-body">
            <strong>内置记忆金字塔<em>默认</em></strong>
            <small>L0~L7 分层与纠错/坑分类写入；自包含零依赖。</small>
          </span>
        </button>
        <button type="button" role="radio" aria-checked={status?.backend === "mcp"} className="memory-backend-option" disabled={busy || !status} onClick={() => void pick("mcp")}>
          <span className="memory-backend-icon"><Server size={16} /></span>
          <span className="memory-backend-body">
            <strong>MCP 记忆服务</strong>
            <small>{status?.installed ? "服务已安装，切换后重启生效。" : "服务未安装 —— 选中它会先回退到内置（不丢记忆）。"}</small>
          </span>
        </button>
      </div>

      {status && (
        <div className="memory-backend-meta">
          <span className={`memory-backend-state${status.backend !== status.effective ? " warn" : ""}`}>当前生效：{status.effective === "mcp" ? "MCP 记忆服务" : "内置记忆金字塔"}{status.backend !== status.effective ? " · 所选后端未就绪" : ""}</span>
          {status.fallbackReason && <span className="memory-backend-fallback">{status.fallbackReason}</span>}
        </div>
      )}

      <div className="memory-backend-actions">
        {!status?.installed ? (
          <button className="primary-setting" disabled={busy || !status} onClick={() => void runAction("install")}>安装 MCP 记忆服务</button>
        ) : (
          <>
            <button className="secondary-setting" disabled={busy} onClick={() => void runAction("verify")}>检测连通性</button>
            <button className="secondary-setting" disabled={busy} onClick={() => void runAction("install")}>重新安装 / 修复</button>
            <button className="secondary-setting" disabled={busy} onClick={() => void runAction("uninstall")}>卸载</button>
          </>
        )}
        {status && <span className="memory-backend-path">装到 <code>{status.installRoot}</code></span>}
        {/* 让用户放心：不需要自己配镜像/挂代理（09-25 用户：「记忆 mcp 安装默认使用国内镜像」） */}
        <span className="memory-backend-note">安装默认走国内镜像（registry.npmmirror.com），依赖与原生绑定同理；镜像不可用时自动换源，无需你配置。</span>
      </div>
      {busyLabel && <p className="settings-status">{busyLabel}</p>}
      {note && <p className="settings-status">{note}</p>}

      {status && (
        <details className="memory-backend-manual">
          <summary>想自己用命令装？（走同一套：应用自带 node，不需要你预装 Node.js）</summary>
          <p className="memory-backend-cmd">{status.installCommand}</p>
          <button className="secondary-setting" onClick={() => void copyCommand()}>复制命令</button>
        </details>
      )}
    </>
  );
}

export function MemoryCenterSection(props: MemoryCenterSectionProps) {
  const { memoryEnabled, setMemoryEnabled, setMemoryCenterTab, setMemoryCenterOpen, memories, memoryGroups, memoryLayers, memoryMode, workspaceMemoryEnabled, threads, scheduledTasks, localSkills, memoryStatus, memoryConfigOpen, memoryGateway, setMemoryGateway, memoryGatewayAction, setMemoryConfigOpen, testMemoryGateway, saveMemoryGateway } = props;
    /* ── 两级信息架构（10-10 用户要求，与开发工具页 / 拓展接口页 / 记忆中心同一套规范）──
     一级只放**分类卡片**（含原先内嵌在主界面里的「记忆后端」与「被委派会话的记忆」两块）；
     内容一律进 SettingsDialog。⛔ 卡片复用跨页通用的 .settings-card*（⛔ 不再自造卡片样式）。 */
  const [openCard, setOpenCard] = useState<string | null>(null);
  const cardMeta: Record<string, { title: string; hint: string; tab: string; detail: string }> = {
    entries: { title: "记忆条目", hint: "按重要度与来源会话整理", tab: "library", detail: "记忆条目按重要度 P0–P3 分层、按来源会话分组：可逐条查看全文、置顶（★ 不会被自动清理）或删除。条目由智能体在干活时自己写下 —— 这里只做查看与整理。" },
    resident: { title: "常驻记忆", hint: "每轮对话自动注入", tab: "layers", detail: "常驻记忆 = 用户档案（跨项目一致）+ 项目记忆（本项目全体共享）+ 近期日志，每轮对话自动注入。分层规则、水位与容量倍率都在弹窗内的「记忆中心 → 常驻记忆」里。" },
    storage: { title: "存储与同步", hint: "本地 / 云端 · 工作区记忆", tab: "storage", detail: "决定记忆条目保存在本机还是通过云端网关召回；工作区记忆开关控制当前项目的背景 / 项目记忆 / 日志是否注入与捕获。" },
    search: { title: "全局搜索", hint: "跨会话 / 记忆 / 任务 / 技能", tab: "search", detail: "一次检索会话、记忆条目、定时任务与技能；命中按会话分组，可直接预览全文或跳到那个会话。" },
  };
  const cards = [
    { key: "entries", icon: <Archive size={15} />, title: "记忆条目", desc: "按重要度与来源会话整理，可逐条查看 / 置顶 / 删除", stat: `${memories.length} 条 · ${memoryGroups.length} 个会话 · ${memoryGroups.reduce((sum: any, g: any) => sum + g.items.filter((it: any) => (it as any).pinned).length, 0)} 置顶` },
    { key: "resident", icon: <BookOpen size={15} />, title: "常驻记忆", desc: "用户档案 · 项目记忆 · 近期日志，每轮对话自动注入", stat: `用户 ${memoryLayers?.budget.user ?? 0} 字 · 背景 ${memoryLayers?.budget.background ?? 0} 字 · 项目 ${memoryLayers?.budget.project ?? 0} 字` },
    { key: "storage", icon: <Cloud size={15} />, title: "存储与同步", desc: "记忆保存在本地或云端；工作区记忆跨会话复用", stat: `${memoryMode === "cloud" ? "云端同步" : "本地"}${workspaceMemoryEnabled ? " · 工作区已开启" : ""}` },
    { key: "search", icon: <Search size={15} />, title: "全局搜索", desc: "检索会话、记忆、任务与技能，命中按会话分组", stat: `${threads.length} 会话 · ${scheduledTasks.length} 任务 · ${localSkills.length} 技能` },
    { key: "delegated", icon: <Bot size={15} />, title: "被委派会话的记忆", desc: "子智能体 / 专家 / 专家团拿到与主会话同口径的记忆", stat: "委派回合同样会写入" },
    { key: "backend", icon: <Database size={15} />, title: "记忆后端", desc: "内置记忆金字塔 ⇄ MCP 记忆服务，二选一", stat: "服务没装好会自动回退内置" },
  ];
  const openMeta = openCard ? cardMeta[openCard] : null;
return (
    <>
      <section className="settings-section stack memory-center">
                    <div className="settings-copy channel-heading"><div><h2>记忆<PageInfo text={<>记忆分「常驻记忆」与「记忆条目」两部分：常驻记忆每轮对话自动注入；条目按需召回，按重要度分 P0–P3 管理。</>} /></h2></div><label className="channel-enable"><input type="checkbox" checked={memoryEnabled} onChange={(event) => void setMemoryEnabled(event.target.checked)} /><span>{memoryEnabled ? "已启用" : "已停用"}</span></label></div>

                    <div className="settings-cards" data-count={cards.length}>
                      {cards.map((card) => (
                        <button type="button" className="settings-card" key={card.key} data-memory-card={card.key} onClick={() => setOpenCard(card.key)}>
                          <span className="settings-card-logo">{card.icon}</span>
                          <span className="settings-card-copy">
                            <strong>{card.title}</strong>
                            <small>{card.desc}</small>
                            <span className="settings-card-stat">{card.stat}</span>
                          </span>
                        </button>
                      ))}
                    </div>

                    <div className="memory-overview-actions">
                      <button className="primary-setting" onClick={() => { setMemoryCenterTab("library"); setMemoryCenterOpen(true); }}><LayoutGrid size={15} />打开记忆中心</button>
                      <span className="muted">浏览条目、编辑常驻记忆、切换存储都在记忆中心里完成，这里只做总览。</span>
                    </div>
                    {memoryStatus && <p className="settings-status">{memoryStatus}</p>}
                    {memoryConfigOpen && <MemoryConfigModal gateway={memoryGateway} setGateway={setMemoryGateway} action={memoryGatewayAction} onClose={() => setMemoryConfigOpen(false)} onTest={() => void testMemoryGateway()} onSave={() => void saveMemoryGateway()} />}

                    {/* 记忆后端（09-25 新增）：内置金字塔 ⇄ MCP 记忆服务二选一。 */}
                  
                    {/* ── 二级弹窗（⛔ 内容一律在这里，不得内嵌到主界面）──────────────────── */}
                    {openCard && openMeta && (
                      <SettingsDialog title={openMeta.title} icon={cards.find((c) => c.key === openCard)?.icon} hint={openMeta.hint} size="lg" onClose={() => setOpenCard(null)}>
                        <div className="settings-section stack">
                          <p className="muted">{openMeta.detail}</p>
                          <div className="memory-overview-actions">
                            <button className="primary-setting" onClick={() => { setMemoryCenterTab(openMeta.tab as any); setMemoryCenterOpen(true); setOpenCard(null); }}><LayoutGrid size={15} />在记忆中心打开</button>
                          </div>
                        </div>
                      </SettingsDialog>
                    )}
                    {openCard === "backend" && (
                      <SettingsDialog title="记忆后端" icon={<Database size={15} />} hint="内置金字塔 ⇄ MCP 记忆服务（二选一）" size="lg" onClose={() => setOpenCard(null)}>
                        <MemoryBackendSection />
                      </SettingsDialog>
                    )}
                    {openCard === "delegated" && (
                      <SettingsDialog title="被委派会话的记忆" icon={<Bot size={15} />} hint="子智能体 / 专家 / 专家团主理人 / 成员" onClose={() => setOpenCard(null)}>
                        <div className="settings-section stack">
                          <p className="muted">子智能体 / 专家 / 专家团主理人 / 成员在被发起时，会拿到与主会话同样的常驻记忆（用户档案 · 项目记忆 · 纪律 · 近期日志），并按本次任务召回相关条目；工作区记忆关掉时只注入用户档案、不做召回。</p>
                          <p className="muted">委派会话同样会写入记忆：回合结束时照常捕获进当日日志，检出纠错时另记一条坑。同一成员的成员会话会被复用，所以它自己也记得之前做过什么。</p>
                        </div>
                      </SettingsDialog>
                    )}
  </section>
    </>
  );
}
