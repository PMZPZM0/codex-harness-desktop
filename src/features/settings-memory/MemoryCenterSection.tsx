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
import { BackendConsolePanel } from "./BackendConsolePanel";
import { BossMemoryPanel } from "./BossMemoryPanel";
import { MemoryBackendBoards, type MemoryBackendId } from "./MemoryBackendBoards";
import { MemoryModePane, MemorySearchPane } from "./MemoryPanes";
import { SettingsDialog } from "../../components/SettingsDialog";
import { ToggleSwitch } from "../../components/SettingsWidgets";
import { BookOpen, Cloud, Crown, Database, ListTree, Server, Users } from "lucide-react";
import { MemoryConfigModal, MemoryInjectPreview } from "../../features/memory";
/* ⛔⛔ 11-11 用户令：「金字塔改掉，不使用」+「加一个工作伙伴记忆模块入口」。
   ⇒ 主界面卡片从「项目库 / 金字塔 / 中枢」改成「项目库 / 记忆条目 / 工作伙伴记忆 / 中枢」。
   ⛔ 这才是用户看的第一屏（上一轮我改的是弹窗内容，主界面一点没动 —— 被截图当场纠正）。 */
import { GroupMemoryPanel, MemoryAtomsPanel } from "../memory-atoms";
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

/** 记忆中心：内容入口（项目库/金字塔/后端/中枢记忆）+ 各类弹窗。 */
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
    atoms: { title: "记忆条目", hint: "索引 + 单条正文 · 一条一个文件", tab: "library", detail: "取代金字塔的新结构：**索引一行一条 + 每条一个独立文件**。改一条只动那一个文件，不再动整篇长文；注入时只取与本轮任务最相关的几条（不是整篇塞进去）。底部可以预览「这句话会注入哪些记忆」。" },
    groups: { title: "工作伙伴记忆", hint: "每个群一份 · 别的群读不到", tab: "groups", detail: "工作伙伴的记忆按**群**隔离：每个群只看到自己的会话记忆（客户口径、分工约定）；项目规则与代码事实是工作区级，所有群共享。" },
    boss: { title: "指挥中枢记忆", hint: "每个指挥中枢一份 · 与项目、普通会话完全拆开", tab: "boss", detail: "指挥中枢的记忆**不在任何项目里**：每个指挥中枢一份专属目录（<userData>/boss-home/memories/<会话id>），与项目共享记忆、普通会话记忆互不相通。删掉指挥中枢，它的记忆目录一起清掉；新建就是全新的一份。" },
  };
  const cards = [
    { key: "shared", icon: <BookOpen size={15} />, title: "项目共享记忆库", desc: "切换项目，查看该项目的共享记忆：用户档案 · 项目规则 · 工作纪律", stat: `${(effectiveSharedProject.split(/[\\/]/).filter(Boolean).pop() || "未选项目")} · 3 类共享内容` },
    { key: "atoms", icon: <ListTree size={15} />, title: "记忆条目", desc: "索引 + 单条正文：一条一个文件，改一条只动一条", stat: "索引 · 按任务召回" },
    { key: "groups", icon: <Users size={15} />, title: "工作伙伴记忆", desc: "按群分开：每个群只看自己的会话记忆，别的群读不到", stat: "按群查看" },
    { key: "boss", icon: <Crown size={15} />, title: "指挥中枢记忆", desc: "每个指挥中枢一份独立记忆：与项目、普通会话完全拆开", stat: "按指挥中枢查看" },
  ];
  const openMeta = openCard ? cardMeta[openCard] : null;
  const backendMeta = backendDetail === "builtin"
    ? { title: "本地记忆库", icon: <Database size={15} />, hint: "工作区开关 · 保存位置" }
    : backendDetail === "mcp"
      ? { title: "MCP 记忆", icon: <Server size={15} />, hint: "安装 · 连通性检查 · 卸载" }
      : backendDetail === "cloud"
        ? { title: "云端记忆", icon: <Cloud size={15} />, hint: "开通状态 · 接通 · 账号隔离" }
        : null;
return (
    <>
      <section className="settings-section stack memory-center">
                    <div className="settings-card settings-toggle-row memory-master-row">
                      <span className="settings-toggle-icon"><Database size={16} /></span>
                      <span className="settings-toggle-text"><strong>记忆</strong></span>
                      <ToggleSwitch checked={Boolean(memoryEnabled)} label="记忆已启用" onChange={(next) => void setMemoryEnabled(next)} />
                    </div>

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
                      <SettingsDialog title="项目共享记忆库" icon={<BookOpen size={15} />} hint="索引 + 原子条目 · 项目规则与代码事实" size="lg" onClose={() => setOpenCard(null)}>
                        {/* ⛔⛔ 11-11 用户令：「外面你是更新了，里面全是旧的」——
                            这一屏原来挂的是书架 + 旧条目槽 + 常驻记忆（全读 L0–L7 层快照）。
                            ⇒ 整块换成新结构：同一个记忆原子面板，项目级条目就在最前面。
                            ⛔ 旧的 MemoryEntriesPane / ResidentMemoryPane 不再挂载（⛔ 不是"藏起来"）。 */}
                        <MemoryAtomsPanel workspace={app.memoryManagementWorkspace} />
                        <MemorySearchPane app={app} />
                      </SettingsDialog>
                    )}
                    {/* ⛔ 11-11：金字塔弹窗（PyramidPanel + 分层规则）整块下线 —— 用户令「改掉，不使用」。
                        ⛔ 这两个组件文件仍在（其他引用点未清），但**设置页不再渲染**；
                           要恢复必须先问用户，⛔ 不许因为"删了可惜"悄悄挂回来。 */}
                    {openCard === "atoms" && openMeta && (
                      <SettingsDialog title="记忆条目" icon={<ListTree size={15} />} hint="索引 · 单条正文 · 注入预览" size="lg" onClose={() => setOpenCard(null)}>
                        <MemoryAtomsPanel workspace={app.memoryManagementWorkspace} />
                        {/* 注入预览与条目**同一套打分**（不是前端假过滤）：改完能立刻验证会注入什么。 */}
                        <MemoryInjectPreview workspace={app.memoryManagementWorkspace} onNotice={app.setNotice} />
                      </SettingsDialog>
                    )}
                    {openCard === "groups" && openMeta && (
                      <SettingsDialog title="工作伙伴记忆" icon={<Users size={15} />} hint="每个群一份 · 别的群读不到" size="lg" onClose={() => setOpenCard(null)}>
                        <GroupMemoryPanel workspace={app.memoryManagementWorkspace} />
                        {/* ⛔ 11-11 用户：「有点心，里面又丑，还有旧的残留」——
                            原来这里还挂着 MemorySourcesPane（它渲染 MemoryWorkbench：
                            顶部一条"记忆分层 L2 10% / L4 9%"的旧概览 + 会话记忆列表）⇒ 整块下掉。
                            ⛔ 中枢/会话的旧分层视图不许在任何一个弹窗里复活。 */}
                      </SettingsDialog>
                    )}
                    {openCard === "boss" && openMeta && (
                      <SettingsDialog title="指挥中枢记忆" icon={<Crown size={15} />} hint="每个指挥中枢一份 · 与项目、普通会话完全拆开" size="lg" onClose={() => setOpenCard(null)}>
                        {/* ⛔ 独立板块（10-25 用户令）：指挥中枢的记忆不在任何项目里 ——
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
