/**
 * 设置页 · memory（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 *
 * ── 10-10 二轮改版（用户要求）────────────────────────────────────────────
 * ① 一级 = 三个**并列**功能入口（项目共享记忆库 / 金字塔记忆架构 / 记忆后端选项），
 *    二级 = 各自的弹窗（内容不内嵌）。
 * ② ⛔ 旧「记忆中心」弹窗与它的入口一并删除：那个弹窗里还压着 5 项能力
 *    （条目浏览 / 全局搜索 / 常驻记忆编辑 / 容量倍率 / 整洁清理），已整块迁进三个弹窗
 *    （见 ./MemoryPanes.tsx）—— ⛔ 不是"删掉功能"，是把它们搬到新家。
 * ③ 旧的 `MemoryBackendSection`（自持状态的记忆后端区块）已删 —— 角色由
 *    `BackendConsolePanel` 接手（同样能读、能切、能装/卸/检测，守卫【150】仍满足）。
 */
import { useState } from "react";
import { PyramidPanel } from "./PyramidPanel";
import { SharedLibraryPanel } from "./SharedLibraryPanel";
import { BackendConsolePanel } from "./BackendConsolePanel";
import { BossMemoryPanel } from "./BossMemoryPanel";
import { MemoryBackendBoards, type MemoryBackendId } from "./MemoryBackendBoards";
import { LayerRulesPane, MemoryEntriesPane, MemoryModePane, MemorySearchPane, MemorySourcesPane, ResidentMemoryPane } from "./MemoryPanes";
import { SettingsDialog } from "../../components/SettingsDialog";
import { PageInfo } from "../../components/SettingsHead";
import { BookOpen, Cloud, Crown, Database, Layers, Server } from "lucide-react";
import { MemoryConfigModal } from "../../features/memory";
import type { HarnessAppApi } from "../app-view/types";
export type MemoryCenterSectionProps = {
  /** App 状态与回调（10-10：迁移后的几个内容页直接吃 app —— 与旧弹窗 `AppViewMemoryPanel({ app })`
   *  同源，避免在注册表里再接 30 条扁平线；那种接线漏一条就是静默 bug）。 */
  app: HarnessAppApi;
  /** 查看某条记忆的全文 */
  setMemoryPreview?: (entry: any) => void;
  /** 跳到某个来源会话 */
  openThread?: (threadId: string) => void;
  memoryEnabled: any; setMemoryEnabled: any; memories: any; memoryGroups: any; memoryLayers: any; memoryMode: any; workspaceMemoryEnabled: any; threads: any; scheduledTasks: any; localSkills: any; memoryStatus: any; memoryConfigOpen: any; memoryGateway: any; setMemoryGateway: any; memoryGatewayAction: any; setMemoryConfigOpen: any; testMemoryGateway: any; saveMemoryGateway: any };

export function MemoryCenterSection(props: MemoryCenterSectionProps) {
  const { app, memoryEnabled, setMemoryEnabled, memories, memoryGroups, memoryLayers, memoryMode, workspaceMemoryEnabled, threads, scheduledTasks, localSkills, memoryStatus, memoryConfigOpen, memoryGateway, setMemoryGateway, memoryGatewayAction, setMemoryConfigOpen, testMemoryGateway, saveMemoryGateway, setMemoryPreview, openThread } = props;
    /* ── 两级信息架构（10-10 用户要求，与开发工具页 / 拓展接口页 / 记忆中心同一套规范）──
     一级只放**分类卡片**（含原先内嵌在主界面里的「记忆后端」与「被委派会话的记忆」两块）；
     内容一律进 SettingsDialog。⛔ 卡片复用跨页通用的 .settings-card*（⛔ 不再自造卡片样式）。 */
  /* ── 三个并列功能入口（10-10 用户要求：「重构为三个并列的功能入口」）──────────────
     ① 项目共享记忆库 —— 可切换项目，看该项目的共享记忆（用户档案 / 项目规则 / 工作纪律）
     ② 金字塔记忆架构 —— 每个会话独立的金字塔式结构（共享层只读 + 独立层可写）
     ③ 记忆后端三板块 —— 本地金字塔 / MCP / 云端各自一块板 + 开关（10-21 用户要求：
        「开那个生效那个，就不用再在记忆后端选了」；后端详细安装在各自的「设置/管理」弹窗里）。
     ⛔ ① ② 是**并列**内容入口；③ 是选择记忆存到哪里，不是第四张内容卡。 */
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [backendDetail, setBackendDetail] = useState<MemoryBackendId | null>(null);
  /* 项目共享记忆库里切换的项目（默认当前工作区；为空则跟随页面工作区） */
  const [sharedProject, setSharedProject] = useState<string>("");
  const effectiveSharedProject = sharedProject || threads.find((t: any) => t?.cwd)?.cwd || "";
  const cardMeta: Record<string, { title: string; hint: string; tab: string; detail: string }> = {
    shared: { title: "项目共享记忆库", hint: "切换项目 · 用户档案 / 项目规则 / 工作纪律", tab: "layers", detail: "按**项目**维度共享的记忆：用户档案（跨项目一致，全项目共用一份）、项目规则（项目宪法 L1 + 项目背景 L3）、工作纪律（L2，注入时排最前）。切换上面的项目即可看别的项目。" },
    pyramid: { title: "金字塔记忆架构", hint: "每个会话独立 · 共享层只读 + 独立层自持", tab: "library", detail: "金字塔是**分层机制**：项目级共享层（L0–L6，本项目所有会话读同一份）+ 会话独立层（L7 碎片池与命名空间条目，别的会话读不到）。下面按**会话**展示：每个会话签到的共享层是同一份，独立层各不相同。" },
    boss: { title: "BOSS 会话记忆", hint: "每个 BOSS 会话一份 · 与项目、普通会话完全拆开", tab: "boss", detail: "BOSS 会话的记忆**不在任何项目里**：每个 BOSS 会话一份专属目录（<userData>/boss-home/memories/<会话id>），与项目共享记忆、普通会话记忆互不相通。删掉 BOSS 会话，它的记忆目录一起清掉；新建就是全新的一份。" },
  };
  const cards = [
    { key: "shared", icon: <BookOpen size={15} />, title: "项目共享记忆库", desc: "切换项目，查看该项目的共享记忆：用户档案 · 项目规则 · 工作纪律", stat: `${(effectiveSharedProject.split(/[\\/]/).filter(Boolean).pop() || "未选项目")} · 3 类共享内容` },
    { key: "pyramid", icon: <Layers size={15} />, title: "金字塔记忆架构", desc: "每个会话独立的金字塔结构：共享层只读、独立层自持", stat: "按会话查看" },
    { key: "boss", icon: <Crown size={15} />, title: "BOSS 会话记忆", desc: "每个 BOSS 会话一份独立记忆：与项目、普通会话完全拆开", stat: "按 BOSS 会话查看" },
  ];
  const openMeta = openCard ? cardMeta[openCard] : null;
  const backendMeta = backendDetail === "builtin"
    ? { title: "本地金字塔记忆", icon: <Database size={15} />, hint: "工作区开关 · 保存位置" }
    : backendDetail === "mcp"
      ? { title: "MCP 记忆", icon: <Server size={15} />, hint: "安装 · 连通性检查 · 卸载" }
      : backendDetail === "cloud"
        ? { title: "云端记忆", icon: <Cloud size={15} />, hint: "开通状态 · 接通 · 账号隔离" }
        : null;
  /* 项目清单：从会话的 cwd 去重（⛔ 不新增 IPC —— 页面已有 threads） */
  const projects = Array.from(new Set((threads ?? []).map((t: any) => String(t?.cwd ?? "")).filter(Boolean))) as string[];
return (
    <>
      <section className="settings-section stack memory-center">
                    <div className="settings-copy channel-heading"><div><h2>记忆<PageInfo text={<>记忆分「常驻记忆」与「记忆条目」两部分：常驻记忆每轮对话自动注入；条目按需召回，按重要度分 P0–P3 管理。</>} /></h2><p>决定 Codex 跨会话记住什么；本地、MCP 与云端三选一。</p></div><label className="channel-enable"><input type="checkbox" checked={memoryEnabled} onChange={(event) => void setMemoryEnabled(event.target.checked)} /><span>{memoryEnabled ? "已启用" : "已停用"}</span></label></div>

                    {/* ⛔⛔ 10-20 用户反馈「这两个选项怎么进不去了」：上一版给前两张卡加了
                        disabled={onlyBuiltin && backend!=="builtin"} —— 渲染层 backend 初值可能是
                        undefined（尚未同步），`undefined !== "builtin"` 为真 ⇒ 内置后端下也被锁死。
                        结论：**入口一律可点**；某页是否"只服务内置"由页内说明承担，不靠禁用表达。 */}
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

                    {/* 10-21：记忆后端不再是一张选择卡 / 一个下拉，而是三块板 + 开关。
                        开关负责"开哪个生效哪个"；每块板的「设置 / 安装 / 开通」进对应详情弹窗。 */}
                    <MemoryBackendBoards
                      memoryEnabled={Boolean(memoryEnabled)}
                      fallbackBackend={app.memoryBackend}
                      onManage={(backend) => setBackendDetail(backend)}
                      onNotice={app.setNotice}
                    />

                    {/* ⛔⛔ 10-10 用户二轮反馈「还保留了旧的记忆板块入口，为什么没有清理干净」：
                        这里原来挂着「打开记忆中心」按钮（指向旧的记忆中心弹窗）。
                        旧弹窗的内容已全部迁进上面内容卡片的二级弹窗
                        （见 ./MemoryPanes.tsx），**入口与旧弹窗一并删除**。 */}
                    {memoryStatus && <p className="settings-status">{memoryStatus}</p>}
                    {memoryConfigOpen && <MemoryConfigModal gateway={memoryGateway} setGateway={setMemoryGateway} action={memoryGatewayAction} onClose={() => setMemoryConfigOpen(false)} onTest={() => void testMemoryGateway()} onSave={() => void saveMemoryGateway()} />}
                    {/* ── 二级弹窗（⛔ 内容一律在这里，不得内嵌到主界面）──────────────────── */}
                    {openCard === "shared" && openMeta && (
                      <SettingsDialog title="项目共享记忆库" icon={<BookOpen size={15} />} hint="切项目看书架 · 常驻记忆 · 记忆条目 · 全局搜索" size="lg" onClose={() => setOpenCard(null)}>
                        {/* ⛔ 这一套用**书架**形态（左书脊 + 右书架），与金字塔（梯形）和
                            控制台（设备面板）刻意区分 —— 用户要求三套界面各自独立、不复用同一模板。 */}
                        <SharedLibraryPanel workspace={effectiveSharedProject} projects={projects} />
                        {/* ── 旧「记忆中心」搬来的三块（10-10 迁移）：常驻记忆 / 记忆条目 / 全局搜索 ──
                            ⛔ 内容零改写，只是换了宿主；⛔ 它们**必须在这里**，否则删掉旧弹窗就是丢功能。 */}
                        <MemoryEntriesPane app={app} />
                        <ResidentMemoryPane app={app} />
                        <MemorySearchPane app={app} />
                      </SettingsDialog>
                    )}
                    {openCard === "pyramid" && openMeta && (
                      <SettingsDialog title="金字塔记忆架构" icon={<Layers size={15} />} hint="先选项目 · 再选会话 · 共享层同一份 / 独立层各自一份" size="lg" onClose={() => setOpenCard(null)}>
                        {/* ⛔ 不复用旧记忆库组件（MemoryWorkbench）：那个回答的是"有哪些记忆"，
                            这里要回答的是"金字塔长什么样、每个会话独立在哪" —— 形态不同。
                          ⛔ 项目与会话都在面板内部切（10-10 二轮反馈：原来没有项目切换、
                            会话也只认"写过记忆的"）—— 面板自己按项目读层快照，不靠外层传。 */}
                        <PyramidPanel workspace={effectiveSharedProject} threads={threads} onOpenThread={(id: string) => openThread?.(id)} />
                        {/* ── 旧「记忆中心」搬来的两块（10-10 迁移）：分层规则 / 按来源看会话记忆 ── */}
                        <LayerRulesPane />
                        <MemorySourcesPane app={app} />
                      </SettingsDialog>
                    )}
                    {openCard === "boss" && openMeta && (
                      <SettingsDialog title="BOSS 会话记忆" icon={<Crown size={15} />} hint="每个 BOSS 会话一份 · 与项目、普通会话完全拆开" size="lg" onClose={() => setOpenCard(null)}>
                        {/* ⛔ 独立板块（10-25 用户令）：BOSS 会话的记忆不在任何项目里 ——
                            放「项目共享记忆库」里既找不到、也会让人误以为它属于某个项目。 */}
                        <BossMemoryPanel threads={threads} onOpenThread={(id: string) => { setOpenCard(null); openThread?.(id); }} onNotice={app.setNotice} />
                      </SettingsDialog>
                    )}
                    {backendDetail && backendMeta && (
                      <SettingsDialog title={backendMeta.title} icon={backendMeta.icon} hint={backendMeta.hint} size="lg" onClose={() => setBackendDetail(null)}>
                        {/* ⛔ 详情弹窗只显示**这一块板**的安装 / 检测 / 开通 / 工作区；
                            三选一由页面上的开关完成，这里不再出现第二套后端选择。 */}
                        <BackendConsolePanel
                          focus={backendDetail}
                          workspace={effectiveSharedProject}
                          workspaceEnabled={workspaceMemoryEnabled}
                          onNotice={app.setNotice}
                          /* 云端记忆未开通时的出口：关掉本弹窗、把设置页切到「云账号」
                             （开通动作只在那里做 —— ⛔ 不在记忆页再实现一套开通流程）。 */
                          onOpenCloudAccount={() => { setOpenCard(null); app.setSettingsPage("cloud"); }}
                        />
                        {/* ── 旧「记忆中心」的「存储与同步」里的**保存位置**（10-10 迁移）──
                            ⛔ 只搬这一段：工作区开关面板里已经有，不重复渲染同一个开关。
                            ⛔ 这一块是 **内置金字塔的第二根轴**（本机 memory.json ⇄ TencentDB Gateway），
                            只对 builtin 有意义 —— MCP 用自己的 memory.db、云端后端走 memapi。 */}
                        {backendDetail === "builtin" ? <MemoryModePane app={app} /> : null}
                      </SettingsDialog>
                    )}
  </section>
    </>
  );
}
